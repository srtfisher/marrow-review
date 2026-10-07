import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const electronPath = createRequire(import.meta.url)('electron') as string;
const FIXTURE_CLI = fileURLToPath(new URL('./fixture-cli.mjs', import.meta.url));
const FAILING_CLI = fileURLToPath(new URL('./failing-cli.mjs', import.meta.url));

/**
 * A userData of its own, and a login shell that reports a PATH holding a stub
 * `claude`, so the missing-Claude dialog stays out of the way.
 */
function sandbox(): { userData: string; shell: string } {
  const root = mkdtempSync(join(tmpdir(), 'marrow-e2e-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'claude'), 0o755);
  const shell = join(root, 'shell');
  writeFileSync(shell, `#!/bin/sh\nprintf '__MARROW_PATH__%s' '${bin}:${process.env.PATH ?? ''}'\n`);
  chmodSync(shell, 0o755);
  return { userData: join(root, 'userData'), shell };
}

async function launch(box: { userData: string; shell: string }, cli = FIXTURE_CLI): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [desktopDir],
    env: { ...process.env, MARROW_DESKTOP_CLI: cli, MARROW_DESKTOP_USER_DATA: box.userData, SHELL: box.shell },
  });
  return { app, page: await app.firstWindow() };
}

const open: ElectronApplication[] = [];
test.afterEach(async () => { await Promise.all(open.splice(0).map((app) => app.close())); });

async function started(box = sandbox()) {
  const launched = await launch(box);
  open.push(launched.app);
  await launched.page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
  return { ...launched, box };
}

test('loads the server page with the desktop bridge', async () => {
  const { page } = await started();
  await expect(page.getByText('Handle server errors')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(window.marrowDesktop ?? {}).sort())).toEqual(['notify', 'savePasses']);
});

test('a review that lands while the window is in the background badges the Dock', async () => {
  test.skip(process.platform !== 'darwin', 'the Dock is macOS');
  const { app, page } = await started();
  await page.getByText('Handle server errors').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur());
  await expect(page.getByText('Errors reach nothing').first()).toBeVisible();
  await expect.poll(() => app.evaluate(({ app }) => app.dock?.getBadge())).toBe('•');
});

test('passes chosen in the page are remembered across a relaunch', async () => {
  const first = await started();
  await first.page.getByRole('button', { name: 'Passes' }).click();
  await first.page.getByRole('checkbox', { name: /^Score/ }).click();
  const settings = join(first.box.userData, 'settings.json');
  await expect.poll(() => JSON.parse(readFileSync(settings, 'utf8')).passes?.verify).toBe(false);
  await first.app.close();
  open.splice(open.indexOf(first.app), 1);

  const second = await started(first.box);
  await second.page.getByRole('button', { name: 'Passes' }).click();
  await expect(second.page.getByRole('checkbox', { name: /^Score/ })).not.toBeChecked();
});

test('a server that cannot start shows its own message, with the link live', async () => {
  const { app, page } = await launch(sandbox(), FAILING_CLI);
  open.push(app);
  await expect(page.getByText('marrow could not start')).toBeVisible();
  await expect(page.getByText(/No GitHub credentials found/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://cli.github.com' })).toBeVisible();
});

test('links off the server open in the browser, never in a second window', async () => {
  const { app, page } = await started();
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = async (url: string) => { opened.push(url); };
  });
  await page.evaluate(() => { window.open('https://github.com/o/r/pull/42', '_blank'); });
  await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual(['https://github.com/o/r/pull/42']);
  expect(app.windows()).toHaveLength(1);
});

test('a new window opens on the pull requests while the first keeps its review', async () => {
  const { app, page } = await started();
  await page.getByText('Handle server errors').click();
  await page.waitForURL(/#\/o\/r\/\d+$/);
  const review = page.url();

  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('new-window')?.click());
  const second = await opened;
  await second.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
  await expect(second.getByText('Handle server errors')).toBeVisible();
  expect(new URL(second.url()).hash).toBe('');
  expect(page.url()).toBe(review);
  expect(app.windows()).toHaveLength(2);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()).sort()))
    .toEqual(['marrow', 'o/r#42 · marrow']);
});

test('restarting the server returns every window to its own page', async () => {
  const { app, page } = await started();
  await page.getByText('Handle server errors').click();
  await page.waitForURL(/#\/o\/r\/\d+$/);
  const route = new URL(page.url()).hash;

  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('new-window')?.click());
  const second = await opened;
  await expect(second.getByText('Handle server errors')).toBeVisible();

  // A mark the reload wipes, so the assertions below cannot pass on the pages from before the restart.
  for (const p of [page, second]) await p.evaluate(() => { (window as { stale?: boolean }).stale = true; });
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('restart-server')?.click());

  const reloaded = (p: Page) => expect.poll(async () => {
    try {
      return await p.evaluate(() => /^http/.test(location.href) && !(window as { stale?: boolean }).stale && document.readyState === 'complete');
    } catch {
      return false;
    }
  }, { timeout: 15_000 }).toBe(true);
  await reloaded(page);
  await reloaded(second);
  expect(new URL(page.url()).hash).toBe(route);
  expect(new URL(second.url()).hash).toBe('');
  await expect(second.getByText('Handle server errors')).toBeVisible();
});

test('a new tab opens in the same window frame, on the pull requests', async () => {
  test.skip(process.platform !== 'darwin', 'window tabs are macOS');
  const { app, page } = await started();
  await page.getByText('Handle server errors').click();
  await page.waitForURL(/#\/o\/r\/\d+$/);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 40, y: 60, width: 1000, height: 700 }));

  const opened = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('new-tab')?.click());
  const tab = await opened;
  await expect(tab.getByText('Handle server errors')).toBeVisible();
  expect(new URL(tab.url()).hash).toBe('');

  // A tab takes its group's frame. Off center, so a window opened beside it would not match by chance.
  const frames = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => JSON.stringify(w.getBounds())));
  await expect.poll(async () => [...new Set(await frames())]).toHaveLength(1);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.tabbingIdentifier))).toEqual(['marrow', 'marrow']);
});
