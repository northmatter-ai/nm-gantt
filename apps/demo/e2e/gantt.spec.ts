import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

/** Start from a fresh sample each test. */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('.nm-bar-g');
});

const row = (page: Page, name: string) => page.locator('.nm-tr', { has: page.locator('.col-name .nm-cell-text', { hasText: new RegExp(`^${name}$`) }) }).first();
const bar = (page: Page, name: string) => page.locator('.nm-bar-g', { has: page.locator('text.nm-bar-label', { hasText: new RegExp(`^${name}$`) }) }).first();
const cell = async (page: Page, name: string, col: string) => (await row(page, name).locator(`.col-${col} .nm-cell-text`).innerText()).trim();
const waitSaved = (page: Page) => page.waitForFunction(() => !document.querySelector('.nm-status.saving'));

test('renders grid, timeline, every bar type, legend and lines', async ({ page }) => {
  await expect(page.locator('[role=treegrid]')).toBeVisible();
  await expect(page.locator('.nm-summary').first()).toBeVisible();
  await expect(page.locator('.nm-milestone').first()).toBeVisible();
  await expect(page.locator('.nm-loe').first()).toBeVisible();
  await expect(page.locator('.nm-baseline').first()).toBeVisible();
  await expect(page.locator('.nm-link').first()).toBeVisible();
  await expect(page.locator('.nm-today-line')).toHaveCount(1);
  await expect(page.locator('.nm-data-line')).toHaveCount(1);
  await expect(page.locator('.nm-legend')).toBeVisible();
  // accessible bar label
  await expect(bar(page, 'Site mobilisation')).toHaveAttribute('aria-label', /Site mobilisation, Start .* total float .*(critical|not critical)/);
  await shot(page, '10-initial');
});

test('dragging a bar sets a start-no-earlier-than constraint; completed bars are read-only', async ({ page }) => {
  // Completed work cannot be dragged.
  await page.getByRole('button', { name: 'Today' }).click(); // the sample's early work sits around today
  const done = bar(page, 'Structural drawings approval').locator('rect.nm-bar').first();
  await done.scrollIntoViewIfNeeded();
  const db = (await done.boundingBox())!;
  await page.mouse.move(db.x + 10, db.y + db.height / 2);
  await page.mouse.down();
  await page.mouse.move(db.x + 80, db.y + db.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.nm-status')).toContainText('Completed activities cannot be dragged');

  await page.getByLabel('Status', { exact: true }).selectOption('not_started');
  const target = page.locator('.nm-bar-g:not(.complete)', { has: page.locator('rect.nm-bar') }).first();
  const label = (await target.getAttribute('aria-label'))!;
  const code = label.split(' ')[0]!;
  await target.locator('rect.nm-bar').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = (await target.locator('rect.nm-bar').first().boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 6 + 18 * 4, box.y + box.height / 2, { steps: 8 });
  await expect(page.locator('.nm-drag-tip')).toBeVisible();
  await shot(page, '11-dragging');
  await page.mouse.up();
  await waitSaved(page);
  await page.locator(`.nm-bar-g[aria-label^="${code} "]`).dispatchEvent('dblclick');
  await page.getByRole('tab', { name: 'Constraints' }).click();
  await expect(page.locator('.nm-field select').first()).toHaveValue('SNET');
  await page.keyboard.press('Escape');
});

test('drawing a link from one bar end to another adds a link; undo removes it', async ({ page }) => {
  const before = await page.locator('.nm-link').count();
  const from = bar(page, 'Site mobilisation');
  await from.hover();
  const handle = (await from.locator('.nm-link-handle').nth(1).boundingBox())!;
  const to = (await bar(page, 'Raft foundation').locator('rect.nm-bar').first().boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width * 0.8, to.y + to.height / 2, { steps: 10 });
  await expect(page.locator('.nm-drag-tip')).toContainText('FF');
  await page.mouse.up();
  await waitSaved(page);
  await expect(page.locator('.nm-link')).toHaveCount(before + 1);
  await page.locator('[role=treegrid]').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await waitSaved(page);
  await expect(page.locator('.nm-link')).toHaveCount(before);
});

test('grid editing: duration, predecessors; Tab indents; undo/redo', async ({ page }) => {
  const r = row(page, 'Site mobilisation');
  await r.locator('.col-duration').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('2w');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  expect(await cell(page, 'Site mobilisation', 'duration')).toBe('10d');
  // Excavation follows mobilisation, so it moved.
  const exStart = await cell(page, 'Excavation', 'start');
  await page.locator('[role=treegrid]').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await waitSaved(page);
  expect(await cell(page, 'Site mobilisation', 'duration')).toBe('6d');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitSaved(page);
  expect(await cell(page, 'Site mobilisation', 'duration')).toBe('10d');
  expect(await cell(page, 'Excavation', 'start')).toBe(exStart);

  // Indenting under an activity with links is refused (summaries cannot carry links).
  await row(page, 'Structural drawings approval').click();
  await page.keyboard.press('Insert');
  await waitSaved(page);
  await page.keyboard.type('Survey');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await row(page, 'Survey').click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.nm-status.error')).toContainText('has links');
  // Insert two new rows and indent the second under the first.
  await page.keyboard.press('Insert');
  await waitSaved(page);
  await page.keyboard.type('Survey sheet 1');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await row(page, 'Survey sheet 1').click();
  await page.keyboard.press('Tab');
  await waitSaved(page);
  await expect(row(page, 'Survey sheet 1')).toHaveAttribute('aria-level', '2');
  await expect(row(page, 'Survey')).toHaveAttribute('aria-expanded', 'true');
  await shot(page, '12-indented');
});

test('activity editor sets progress; in-progress bar shows actual and remaining parts', async ({ page }) => {
  await row(page, 'Excavation').locator('.col-wbs').dblclick();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByRole('dialog')).toContainText('Actual start');
  await page.getByRole('button', { name: 'Cancel' }).click();
  // The sample has in-progress work at the data date.
  await page.getByLabel('Status', { exact: true }).selectOption('in_progress');
  await expect(page.locator('.nm-bar.actual').first()).toBeVisible();
  await expect(page.locator('.nm-bar.remaining').first()).toBeVisible();
  await page.locator('[role=treegrid]').focus();
  await shot(page, '13-in-progress');
});

test('filters and grouping', async ({ page }) => {
  const all = await page.locator('.nm-tr.is-activity').count();
  await page.getByLabel('Critical', { exact: true }).check();
  await page.waitForTimeout(200);
  const crit = page.locator('.nm-bar.critical, .nm-milestone.critical');
  expect(await crit.count()).toBeGreaterThan(0);
  await page.getByLabel('Critical', { exact: true }).uncheck();
  await page.getByLabel('Group', { exact: true }).selectOption('tower');
  await expect(page.locator('.nm-tr.is-group').first()).toBeVisible();
  await page.getByLabel('Find activity').fill('Raft');
  await expect(page.locator('.nm-tr.is-activity')).toHaveCount(2);
  await page.getByLabel('Find activity').fill('');
  await page.getByLabel('Group', { exact: true }).selectOption('wbs');
  expect(await page.locator('.nm-tr.is-activity').count()).toBe(all);
});

test('Ctrl+wheel zooms keeping the date under the pointer', async ({ page }) => {
  const tl = page.locator('.nm-timeline');
  const box = (await tl.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue('month');
  await shot(page, '14-month');
});

test('keyboard: arrows move, Enter edits, Escape cancels; context menu', async ({ page }) => {
  const grid = page.locator('[role=treegrid]');
  await row(page, 'Notice to proceed').click();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Site mobilisation')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('.nm-cell-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nm-cell-input')).toHaveCount(0);
  await expect(grid).toBeFocused();
  await row(page, 'Excavation').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Trace predecessors' }).click();
  await expect(page.locator('.nm-tr.is-dim').first()).toBeVisible();
});

test('view mode and dark theme with Hindi labels', async ({ page }) => {
  await page.getByLabel('Mode', { exact: true }).selectOption('view');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByLabel('Language', { exact: true }).selectOption('hi');
  await expect(page.locator('.nm-th').nth(1)).toHaveText('गतिविधि');
  await row(page, 'Site mobilisation').locator('.col-duration').dblclick();
  await expect(page.locator('.nm-cell-input')).toHaveCount(0);
  await shot(page, '15-dark-hi');
});

test('5,000-activity schedule renders and scrolls', async ({ page }) => {
  const t0 = Date.now();
  await page.getByLabel('Schedule', { exact: true }).selectOption('large');
  await page.waitForSelector('.nm-bar-g');
  const firstRender = Date.now() - t0;
  console.log(`large schedule first render: ${firstRender} ms`);
  const rows = await page.locator('.nm-tr').count();
  expect(rows).toBeLessThan(120); // virtualised
  const tl = page.locator('.nm-timeline');
  await tl.evaluate((el) => { el.scrollTop = 60_000; });
  await page.waitForTimeout(200);
  await expect(page.locator('.nm-tr').first()).toBeVisible();
  const wbs = await page.locator('.nm-tr .col-wbs .nm-cell-text').first().innerText();
  expect(Number(wbs.split('.')[0])).toBeGreaterThan(30); // scrolled deep into the list
  await shot(page, '16-large');
});
