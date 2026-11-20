import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = process.env.SHOT_DIR;
const DAY_PX = 48; // day zoom

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('.nm-bar-g');
  await page.getByLabel('Zoom', { exact: true }).selectOption('day');
  await page.waitForTimeout(250);
});

const waitSaved = (page: Page) => page.waitForFunction(() => !document.querySelector('.nm-status.saving'));
const rowByCode = (page: Page, code: string) => page.locator(`.nm-tr:has(#${''})`).filter({ hasText: code });
const cellText = async (page: Page, code: string, col: string) => {
  const id = await page.locator(`.nm-bar-g[aria-label^="${code} "]`).getAttribute('data-id');
  const label = (await page.locator(`.nm-bar-g[data-id="${id}"]`).getAttribute('aria-label'))!;
  void rowByCode; void col;
  return label;
};

/** First not-started task bar on screen; returns its group locator and code. */
async function notStartedBar(page: Page): Promise<{ g: Locator; code: string }> {
  await page.getByLabel('Status', { exact: true }).selectOption('not_started');
  await page.getByLabel('Group', { exact: true }).selectOption('none');
  const g = page.locator('.nm-bar-g:not(.complete):not(.critical)', { has: page.locator('rect.nm-bar') }).first();
  await g.locator('rect.nm-bar').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const code = (await g.getAttribute('aria-label'))!.split(' ')[0]!;
  return { g: page.locator(`.nm-bar-g[aria-label^="${code} "]`), code };
}

async function dragBy(page: Page, target: Locator, dx: number, at: 'center' | 'left' | 'right' = 'center') {
  const b = (await target.boundingBox())!;
  const x = at === 'left' ? b.x + 2 : at === 'right' ? b.x + b.width - 2 : b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await expect(page.locator('.nm-drag-tip')).toBeVisible();
  return async () => { await page.mouse.up(); await waitSaved(page); };
}

const datesOf = async (g: Locator) => {
  const label = (await g.getAttribute('aria-label'))!;
  const m = /Start (.+?), Finish (.+?),/.exec(label)!;
  return { start: m[1]!, finish: m[2]! };
};

test('stretching the right end changes the finish (duration); the tooltip shows the new duration', async ({ page }) => {
  const { g } = await notStartedBar(page);
  const before = await datesOf(g);
  const up = await dragBy(page, g.locator('.nm-grip-hit').last(), DAY_PX * 2, 'center');
  await expect(page.locator('.nm-drag-tip')).toContainText('Duration');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/30-stretch-end.png` });
  await up();
  const after = await datesOf(g);
  expect(after.start).toBe(before.start);
  expect(after.finish).not.toBe(before.finish);
});

test('stretching the left end changes the start and keeps the finish', async ({ page }) => {
  const { g } = await notStartedBar(page);
  const before = await datesOf(g);
  const up = await dragBy(page, g.locator('.nm-grip-hit').first(), DAY_PX * 1, 'center');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/31-stretch-start.png` });
  await up();
  const after = await datesOf(g);
  expect(after.start).not.toBe(before.start);
  expect(after.finish).toBe(before.finish);
});

test('moving a bar moves both dates', async ({ page }) => {
  const { g } = await notStartedBar(page);
  const before = await datesOf(g);
  const up = await dragBy(page, g.locator('rect.nm-bar').first(), DAY_PX * 3, 'center');
  await up();
  const after = await datesOf(g);
  expect(after.start).not.toBe(before.start);
  expect(after.finish).not.toBe(before.finish);
});

test('in-progress bar: moving explains the fixed start; stretching the end changes remaining work', async ({ page }) => {
  await page.getByLabel('Status', { exact: true }).selectOption('in_progress');
  const g = page.locator('.nm-bar-g', { has: page.locator('rect.nm-bar.remaining') }).first();
  await g.locator('rect.nm-bar.remaining').scrollIntoViewIfNeeded();
  const code = (await g.getAttribute('aria-label'))!.split(' ')[0]!;
  const bar = page.locator(`.nm-bar-g[aria-label^="${code} "]`);
  const rb = (await bar.locator('rect.nm-bar.remaining').boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 60, rb.y + rb.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.nm-status')).toContainText('start is fixed');
  const before = await datesOf(bar);
  const up = await dragBy(page, bar.locator('.nm-grip-hit').last(), DAY_PX * 2, 'center');
  await expect(page.locator('.nm-drag-tip')).toContainText('Remaining');
  await up();
  const after = await datesOf(bar);
  expect(after.start).toBe(before.start);
  expect(after.finish).not.toBe(before.finish);
});

test('dragging a summary moves the not-started work inside it', async ({ page }) => {
  await page.getByLabel('Zoom', { exact: true }).selectOption('week');
  await page.getByLabel('Find activity').fill('T1-F06');
  await page.waitForTimeout(200);
  const summary = page.locator('.nm-bar-g', { has: page.locator('path.nm-summary') }).filter({ has: page.locator('text.nm-bar-label', { hasText: /^Floor 6$/ }) }).first();
  await summary.scrollIntoViewIfNeeded();
  const before = await datesOf(summary);
  const up = await dragBy(page, summary.locator('path.nm-summary'), 18 * 7, 'center');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/32-summary-drag.png` });
  await up();
  const after = await datesOf(summary);
  expect(after.start).not.toBe(before.start);
});

test('typing a finish date in the grid changes the duration', async ({ page }) => {
  const { code } = await notStartedBar(page);
  const row = page.locator('.nm-tr', { has: page.locator('.col-wbs') }).filter({ has: page.locator(`.nm-cell-text:text-is("${(await page.locator(`.nm-bar-g[aria-label^="${code} "] text.nm-bar-label`).textContent())!}")`) }).first();
  const durBefore = (await row.locator('.col-duration .nm-cell-text').innerText()).trim();
  await row.locator('.col-finish').dblclick();
  const input = page.locator('.nm-cell-input');
  await expect(input).toHaveAttribute('type', 'date');
  const v = await input.inputValue();
  const d = new Date(`${v}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3);
  await input.fill(d.toISOString().slice(0, 10));
  await input.press('Enter');
  await waitSaved(page);
  const durAfter = (await row.locator('.col-duration .nm-cell-text').innerText()).trim();
  expect(durAfter).not.toBe(durBefore);
  void cellText;
});
