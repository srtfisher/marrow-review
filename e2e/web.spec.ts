import { expect, test } from '@playwright/test';
import { startFixture, type Fixture } from './fixture.js';

let fixture: Fixture;
test.beforeEach(async () => { fixture = await startFixture(); });
test.afterEach(async () => { await fixture.stop(); });

test('opens a pull request from the picker and shows its diff and findings', async ({ page }) => {
  await page.goto(fixture.url);
  await page.getByText('Handle server errors').click();

  await expect(page.getByRole('heading', { name: /Handle server errors/ })).toBeVisible();
  await expect(page.getByText('src/app.ts').first()).toBeVisible();
  await expect(page.getByText('Errors reach nothing').first()).toBeVisible();
  await expect(page.getByText('score 90').first()).toBeVisible();
});

test('review requests from any repository are listed under the picker and the cursor reaches them', async ({ page }) => {
  await page.goto(fixture.url);
  const inbox = page.getByRole('listbox', { name: 'Review requested' });
  await expect(inbox.getByText('Retry flaky uploads')).toBeVisible();
  await expect(inbox.getByText('acme/api')).toBeVisible();

  await page.getByLabel('Filter pull requests').press('ArrowDown');
  await expect(inbox.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Filter pull requests').press('Enter');
  await expect(page.getByRole('heading', { name: /Handle server errors/ })).toBeVisible();
});

test('a pass switched off reaches the server and survives a reload', async ({ page }) => {
  await page.goto(fixture.url);
  await page.getByRole('button', { name: 'Passes' }).click();
  const score = page.getByRole('checkbox', { name: /^Score/ });
  await expect(score).toBeChecked();
  await score.click();
  await expect(score).not.toBeChecked();

  await page.reload();
  await page.getByRole('button', { name: 'Passes' }).click();
  await expect(page.getByRole('checkbox', { name: /^Score/ })).not.toBeChecked();
});

test('in a browser the desktop bridge is absent and nothing errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(fixture.url);
  await page.getByText('Handle server errors').click();
  await expect(page.getByText('Errors reach nothing').first()).toBeVisible();

  expect(await page.evaluate(() => typeof (globalThis as { marrowDesktop?: unknown }).marrowDesktop)).toBe('undefined');
  expect(errors).toEqual([]);
});

test('the finish dialog opens on the summary and picks a verdict from the keyboard', async ({ page }) => {
  await page.goto(fixture.url);
  await page.getByText('Handle server errors').click();
  await expect(page.getByText('Errors reach nothing').first()).toBeVisible();

  await page.keyboard.press('!');
  const summary = page.getByLabel('Review summary');
  await expect(summary).toBeFocused();
  await summary.press('Alt+2');
  await expect(page.getByRole('radio', { name: /^Approve/ })).toBeChecked();
  await expect(summary).toHaveValue('');
  await summary.press('Alt+3');
  await expect(page.getByRole('radio', { name: /^Request changes/ })).toBeChecked();
});

test('in the Mac app a submitted review returns to the picker with a notice', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { marrowDesktop?: unknown }).marrowDesktop = { notify: () => {}, savePasses: () => {} };
  });
  await page.goto(fixture.url);
  await page.getByText('Handle server errors').click();
  await expect(page.getByText('Errors reach nothing').first()).toBeVisible();

  await page.keyboard.press('!');
  await page.getByLabel('Review summary').fill('Looks good.');
  await page.getByLabel('Review summary').press('ControlOrMeta+Enter');

  await expect(page.getByRole('status')).toContainText(/Review submitted on #\d+/);
  await expect(page.getByLabel('Filter pull requests')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('in a browser a submitted review lands on its own page', async ({ page }) => {
  await page.goto(fixture.url);
  await page.getByText('Handle server errors').click();
  await expect(page.getByText('Errors reach nothing').first()).toBeVisible();

  await page.keyboard.press('!');
  await page.getByLabel('Review summary').fill('Looks good.');
  await page.getByLabel('Review summary').press('ControlOrMeta+Enter');
  await expect(page.getByRole('heading', { name: 'Review submitted' })).toBeVisible();
});
