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
