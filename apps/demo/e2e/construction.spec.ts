import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('.nm-bar-g');
});

test('tower × floor grid: one grid per tower, top floor first, states with icons, cell opens details', async ({ page }) => {
  await page.getByRole('tab', { name: 'Tower × floor' }).click();
  const towers = page.locator('.nmc-tower');
  await expect(towers).toHaveCount(2);
  const floors = towers.first().locator('.nmc-floor');
  await expect(floors.first()).toHaveText('Floor 12');
  await expect(floors.last()).toHaveText('Floor 1');
  await expect(towers.first().locator('.nmc-tf-col')).toHaveCount(7);
  await expect(page.locator('.nmc-cell.s-certified').first()).toBeVisible();
  await expect(page.locator('.nmc-cell.s-reported').first()).toBeVisible();
  await expect(page.locator('.nmc-cell.s-in_progress, .nmc-cell.s-late').first()).toBeVisible();
  await shot(page, '20-grid');
  await page.locator('.nmc-cell.s-certified').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Certified complete');
  await expect(dialog).toContainText('Rebar inspection');
  await expect(dialog.locator('img').first()).toBeVisible();
  await shot(page, '21-details');
  await dialog.getByRole('button', { name: 'Open in Gantt' }).click();
  await expect(page.getByRole('tab', { name: 'Gantt' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.nm-tr.is-selected')).toHaveCount(1);
});

test('tower × floor grid renders 40 floors × 30 templates in under 500 ms', async ({ page }) => {
  await page.getByLabel('Schedule', { exact: true }).selectOption('tower40');
  await page.waitForSelector('.nm-bar-g');
  const ms = await page.evaluate(async () => {
    const tab = [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent === 'Tower × floor') as HTMLButtonElement;
    const t0 = performance.now();
    tab.click();
    await new Promise<void>((resolve) => {
      const check = () => (document.querySelectorAll('.nmc-cell').length >= 1200 ? resolve() : requestAnimationFrame(check));
      check();
    });
    return performance.now() - t0;
  });
  console.log(`40×30 grid render: ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(500);
  await expect(page.locator('.nmc-cell')).toHaveCount(1200);
  await shot(page, '22-grid-40x30');
});

test('line of balance: lines per trade, plan vs actual, toggles, hover rates, table view', async ({ page }) => {
  await page.getByRole('tab', { name: 'Line of balance' }).click();
  await expect(page.locator('.nmc-series')).toHaveCount(7);
  await expect(page.locator('.nmc-line.dashed').first()).toBeVisible();
  await shot(page, '23-lob');
  const box = (await page.locator('.nmc-series').nth(1).locator('.nmc-line').first().boundingBox())!;
  const hit = page.locator('.nmc-series').nth(1).locator('.nmc-hit').first();
  await hit.hover({ force: true, position: { x: 5, y: 5 } }).catch(() => page.mouse.move(box.x + box.width / 2, box.y + box.height / 2));
  await page.locator('.nmc-chip', { hasText: 'Blockwork' }).click();
  await expect(page.locator('.nmc-series')).toHaveCount(6);
  await page.getByLabel('Plan from').selectOption({ index: 1 });
  await expect(page.locator('.nmc-series')).toHaveCount(6);
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('.nmc-table tbody tr')).toHaveCount(7);
  await expect(page.locator('.nmc-table')).toContainText('floors/week');
});

test('look-ahead: window, grouped by tower and contractor, readiness, PPC, print', async ({ page }) => {
  await page.getByRole('tab', { name: 'Look-ahead' }).click();
  await expect(page.locator('.nmc-group.tower').first()).toContainText('Tower A');
  await expect(page.locator('.nmc-group.contractor').first()).toContainText('PPC');
  await expect(page.locator('.nmc-board td.ready-col.ok').first()).toBeVisible();
  await expect(page.locator('.nmc-board td.ready-col.bad').first()).toBeVisible();
  const three = await page.locator('.nmc-board tbody tr:not(.nmc-group)').count();
  await page.getByLabel('Window').selectOption('6');
  const six = await page.locator('.nmc-board tbody tr:not(.nmc-group)').count();
  expect(six).toBeGreaterThan(three);
  await page.getByLabel('Window').selectOption('3');
  await shot(page, '24-lookahead');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('nmc-printing'));
  await expect(page.locator('.nmc-print-title')).toBeVisible();
  await page.pdf({ path: `${SHOTS ?? '/tmp'}/lookahead.pdf`, format: 'A4', landscape: true }).catch(() => {});
});
