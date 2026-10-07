import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, utilityProcess, type IpcMainEvent, type UtilityProcess } from 'electron';
import { execFile } from 'node:child_process';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExecutable, loginShellPath, osascriptNotice, parseServerUrl, passFlags, tail, toNotice, toPasses, windowTitle, withRoute, type Passes } from './child.js';

const here = dirname(fileURLToPath(import.meta.url));
// Packaged, marrow is staged into Resources outside the asar: the Claude SDK
// spawns a native binary, which cannot run from inside the archive.
// MARROW_DESKTOP_CLI and MARROW_DESKTOP_USER_DATA exist for the e2e tests: a
// fixture server in place of marrow, and settings that are not yours.
const cliPath = process.env.MARROW_DESKTOP_CLI
  ?? (app.isPackaged ? join(process.resourcesPath, 'marrow', 'dist', 'cli.js') : join(here, '..', '..', 'dist', 'cli.js'));
if (process.env.MARROW_DESKTOP_USER_DATA) app.setPath('userData', process.env.MARROW_DESKTOP_USER_DATA);
const settingsPath = join(app.getPath('userData'), 'settings.json');

interface Settings {
  clone: string | null;
  /**
   * The page's origin includes the port, and localStorage (the theme) is per
   * origin: a fresh port every launch forgot it every launch.
   */
  port: number | null;
  /** The server keeps passes in memory; the app replays them as flags on the next start. */
  passes: Passes | null;
}

function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<Settings>;
    return {
      clone: typeof parsed.clone === 'string' ? parsed.clone : null,
      port: typeof parsed.port === 'number' ? parsed.port : null,
      passes: toPasses(parsed.passes),
    };
  } catch {
    return { clone: null, port: null, passes: null };
  }
}

function saveSettings(settings: Settings): void {
  try {
    writeFileSync(settingsPath, JSON.stringify(settings));
  } catch {
    // Forgetting the clone next launch is the whole cost.
  }
}

let settings = loadSettings();
// Every window is a page on the one server, which already holds a session per pull request.
const windows = new Set<BrowserWindow>();
// The last server page each window showed, read back when a restarted server has a new URL.
const pages = new WeakMap<BrowserWindow, string>();
let status: { state: 'starting' | 'error'; detail: string } = { state: 'starting', detail: '' };
let child: UtilityProcess | null = null;
let serverOrigin: string | null = null;
let serverUrl: string | null = null;
let pathPromise: Promise<string> | null = null;
let warnedNoClaude = false;

// $HOME rather than app.getPath('home'): Claude Code's installers go by $HOME.
const home = process.env.HOME || app.getPath('home');
// Where Claude Code's own installers put it, for a login shell that does not.
const CLAUDE_DIRS = [join(home, '.local', 'bin'), join(home, '.claude', 'local')];

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function warnNoClaude(): Promise<void> {
  const options = {
    type: 'warning' as const,
    message: 'Claude Code is not installed',
    detail: 'marrow found no `claude` on your PATH. The diff, the abridgement rules, your comments, and submitting all still work; Claude\'s passes will not run.\n\nInstall Claude Code and sign in, then choose File › Restart Server.',
    buttons: ['Get Claude Code', 'OK'],
    defaultId: 0,
    cancelId: 1,
  };
  // A sheet asked for on a window not yet shown is never drawn.
  const target = dialogParent();
  if (target && !target.isVisible()) await new Promise<void>((resolve) => { target.once('show', () => resolve()); });
  const { response } = target ? await dialog.showMessageBox(target, options) : await dialog.showMessageBox(options);
  if (response === 0) void shell.openExternal('https://claude.com/claude-code');
}

function dialogParent(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? windows.values().next().value ?? null;
}

function loadStatus(w: BrowserWindow): void {
  void w.loadFile(join(here, '..', 'static', 'loading.html'), { query: status });
}

function showStatus(state: 'starting' | 'error', detail = ''): void {
  status = { state, detail };
  for (const w of windows) loadStatus(w);
}

function stopServer(): void {
  const running = child;
  child = null;
  serverOrigin = null;
  serverUrl = null;
  running?.kill();
}

async function startServer(): Promise<void> {
  stopServer();
  showStatus('starting');
  pathPromise ??= loginShellPath(process.env);
  const path = await pathPromise;
  const env = { ...process.env, PATH: path };

  // The machine's Claude Code, not a copy bundled into the app; a missing one
  // still starts the server, since every model pass is additive.
  const claude = findExecutable('claude', [...path.split(':'), ...CLAUDE_DIRS], isExecutable);
  if (!claude && !warnedNoClaude) {
    warnedNoClaude = true;
    void warnNoClaude();
  }

  const port = settings.port;
  const args = [
    '--no-open',
    '--claude-path', claude ?? join(CLAUDE_DIRS[0]!, 'claude'),
    ...passFlags(settings.passes),
    ...(port === null ? [] : ['--port', String(port)]),
  ];
  const proc = utilityProcess.fork(cliPath, args, {
    cwd: settings.clone ?? home,
    env,
    stdio: 'pipe',
    serviceName: 'marrow server',
  });
  child = proc;
  let stdout = '';
  let stderr = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    if (serverOrigin !== null) return;
    for (const line of stdout.split('\n')) {
      const url = parseServerUrl(line);
      if (url && child === proc) {
        const parsed = new URL(url);
        serverOrigin = parsed.origin;
        serverUrl = url;
        if (Number(parsed.port) !== settings.port) {
          settings = { ...settings, port: Number(parsed.port) };
          saveSettings(settings);
        }
        for (const w of windows) void w.loadURL(withRoute(url, pages.get(w)));
        return;
      }
    }
  });
  proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  proc.on('exit', (code) => {
    // A replaced server exits too, and that is not an error worth showing.
    if (child !== proc) return;
    child = null;
    serverOrigin = null;
    serverUrl = null;
    // The remembered port may be taken by now; one more try on any port.
    if (port !== null && /EADDRINUSE/.test(stderr)) {
      settings = { ...settings, port: null };
      saveSettings(settings);
      void startServer();
      return;
    }
    showStatus('error', tail(stderr) || `marrow exited with code ${code}.`);
  });
}

function isServerUrl(url: string): boolean {
  try {
    return serverOrigin !== null && new URL(url).origin === serverOrigin;
  } catch {
    return false;
  }
}

function openExternal(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function createWindow(asTab = false): void {
  const focused = BrowserWindow.getFocusedWindow();
  // Offset from the window it was opened over, or it lands exactly on top and looks like nothing happened.
  const over = asTab ? undefined : focused?.getPosition();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    ...(over ? { x: over[0]! + 24, y: over[1]! + 24 } : {}),
    title: windowTitle('marrow', settings.clone),
    tabbingIdentifier: 'marrow',
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  windows.add(win);
  if (asTab && focused) focused.addTabbedWindow(win);
  win.on('new-window-for-tab', () => createWindow(true));
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (event, title) => {
    event.preventDefault();
    win.setTitle(windowTitle(title, settings.clone));
  });
  win.on('focus', () => app.dock?.setBadge(''));
  win.on('closed', () => { windows.delete(win); });

  const remember = (_event: unknown, url: string) => { if (/^https?:/.test(url)) pages.set(win, url); };
  win.webContents.on('did-navigate', remember);
  win.webContents.on('did-navigate-in-page', remember);

  // Links leave for the browser: a GitHub page inside the review window has no way back.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isServerUrl(url) || url.startsWith('file:')) return;
    event.preventDefault();
    openExternal(url);
  });

  if (serverUrl) void win.loadURL(serverUrl); else loadStatus(win);
}

function gitTopLevel(folder: string, path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', folder, 'rev-parse', '--show-toplevel'], { env: { ...process.env, PATH: path } }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}

async function openClone(): Promise<void> {
  const options = {
    title: 'Open Local Checkout',
    message: 'Choose a git checkout of the repository you review, so Claude can search it.',
    buttonLabel: 'Open',
    properties: ['openDirectory' as const],
    defaultPath: settings.clone ?? home,
  };
  const win = dialogParent();
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return;
  pathPromise ??= loginShellPath(process.env);
  const root = await gitTopLevel(folder, await pathPromise);
  if (!root) {
    const notice = {
      type: 'warning' as const,
      message: `${basename(folder)} is not a git checkout`,
      detail: 'Choose the folder you cloned the repository into, the one with a .git directory. Without one, marrow reads the pull request through the GitHub API.',
    };
    if (win) await dialog.showMessageBox(win, notice); else await dialog.showMessageBox(notice);
    return;
  }
  settings = { ...settings, clone: root };
  saveSettings(settings);
  void startServer();
}

function closeClone(): void {
  settings = { ...settings, clone: null };
  saveSettings(settings);
  void startServer();
}

async function showAbout(): Promise<void> {
  const options = {
    message: `marrow ${app.getVersion()}`,
    detail: 'By Sean Fisher\n© Sean Fisher · MIT License',
    buttons: ['OK', 'View on GitHub'],
    defaultId: 0,
    cancelId: 0,
  };
  const win = dialogParent();
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (response === 1) openExternal(REPO_URL);
}

function buildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: 'appMenu',
      submenu: [
        // macOS draws the standard About panel's credits as plain text, so a link there cannot be clicked.
        { label: 'About marrow', click: () => void showAbout() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { id: 'new-window', label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { id: 'new-tab', label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => createWindow(true) },
        { type: 'separator' },
        { label: 'Open Local Checkout…', accelerator: 'CmdOrCtrl+O', click: () => void openClone() },
        { label: 'Close Local Checkout', click: closeClone },
        { type: 'separator' },
        { id: 'restart-server', label: 'Restart Server', click: () => void startServer() },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'marrow on GitHub', click: () => openExternal(REPO_URL) }] },
  ]));
}

/** The window a message came from, if it is one of ours showing the server's page; the page is untrusted. */
function senderWindow(event: IpcMainEvent): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && windows.has(win) && isServerUrl(event.senderFrame?.url ?? '') ? win : null;
}

ipcMain.on('marrow:passes', (event, raw: unknown) => {
  if (!senderWindow(event)) return;
  const passes = toPasses(raw);
  if (!passes) return;
  settings = { ...settings, passes };
  saveSettings(settings);
});

ipcMain.on('marrow:notify', (event, raw: unknown) => {
  const win = senderWindow(event);
  if (!win) return;
  const notice = toNotice(raw);
  // Looking at the page, the page is the notification.
  if (!notice || win.isFocused()) return;
  app.dock?.setBadge('•');
  const note = new Notification({ title: notice.title, body: notice.body });
  note.on('click', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  // Ad-hoc signed, this is every time: "Notifications are not allowed for this application".
  note.on('failed', (_event, error) => {
    process.stderr.write(`marrow: notification failed: ${error}\n`);
    app.dock?.bounce('informational');
    execFile('osascript', osascriptNotice(notice), (fallback) => {
      if (fallback) process.stderr.write(`marrow: osascript notification failed: ${fallback.message}\n`);
    });
  });
  note.show();
});

const REPO_URL = 'https://github.com/srtfisher/marrow-review';

app.setName('marrow');
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  void startServer();
  app.on('activate', () => { if (windows.size === 0) createWindow(); });
});

// Closing the last window is quitting: the server lives for the windows.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', stopServer);
