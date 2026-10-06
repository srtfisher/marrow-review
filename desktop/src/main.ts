import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, utilityProcess, type UtilityProcess } from 'electron';
import { execFile } from 'node:child_process';
import { accessSync, constants, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExecutable, loginShellPath, parseServerUrl, passFlags, tail, toNotice, toPasses, type Passes } from './child.js';

const here = dirname(fileURLToPath(import.meta.url));
// Packaged, marrow is staged into Resources outside the asar: the Claude SDK
// spawns a native binary, which cannot run from inside the archive.
const cliPath = app.isPackaged
  ? join(process.resourcesPath, 'marrow', 'dist', 'cli.js')
  : join(here, '..', '..', 'dist', 'cli.js');
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
let win: BrowserWindow | null = null;
let child: UtilityProcess | null = null;
let serverOrigin: string | null = null;
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
  const target = win;
  if (target && !target.isVisible()) await new Promise<void>((resolve) => { target.once('show', () => resolve()); });
  const { response } = target ? await dialog.showMessageBox(target, options) : await dialog.showMessageBox(options);
  if (response === 0) void shell.openExternal('https://claude.com/claude-code');
}

function showStatus(state: 'starting' | 'error', detail = ''): void {
  void win?.loadFile(join(here, '..', 'static', 'loading.html'), { query: { state, detail } });
}

function setTitle(): void {
  win?.setTitle(settings.clone ? `marrow — ${basename(settings.clone)}` : 'marrow');
}

function stopServer(): void {
  const running = child;
  child = null;
  serverOrigin = null;
  running?.kill();
}

async function startServer(): Promise<void> {
  stopServer();
  setTitle();
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
        if (Number(parsed.port) !== settings.port) {
          settings = { ...settings, port: Number(parsed.port) };
          saveSettings(settings);
        }
        void win?.loadURL(url);
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // The page names itself "marrow"; the title is ours, to show the clone.
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('focus', () => app.dock?.setBadge(''));
  win.on('closed', () => { win = null; });

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

  void startServer();
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

function buildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Open Local Checkout…', accelerator: 'CmdOrCtrl+O', click: () => void openClone() },
        { label: 'Close Local Checkout', click: closeClone },
        { type: 'separator' },
        { label: 'Restart Server', click: () => void startServer() },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}

ipcMain.on('marrow:passes', (event, raw: unknown) => {
  if (!win || event.sender !== win.webContents || !isServerUrl(event.senderFrame?.url ?? '')) return;
  const passes = toPasses(raw);
  if (!passes) return;
  settings = { ...settings, passes };
  saveSettings(settings);
});

ipcMain.on('marrow:notify', (event, raw: unknown) => {
  if (!win || event.sender !== win.webContents || !isServerUrl(event.senderFrame?.url ?? '')) return;
  const notice = toNotice(raw);
  // Looking at the page, the page is the notification.
  if (!notice || win.isFocused()) return;
  app.dock?.setBadge('•');
  const note = new Notification({ title: notice.title, body: notice.body });
  note.on('click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  note.on('failed', (_event, error) => process.stderr.write(`marrow: notification failed: ${error}\n`));
  note.show();
});

app.setName('marrow');
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

// One window, and closing it is quitting: the server lives for the window.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', stopServer);
