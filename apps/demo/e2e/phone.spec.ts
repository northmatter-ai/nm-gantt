import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SHOT_DIR;

const firstBarWidth = (page: Page) => page.locator('.nm-ph-row .nm-ph-fill').first().evaluate((el) => el.getBoundingClientRect().width);

test.describe('phone', () => {
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('.nm-ph-row');
});

test('phones get the read-only list-plus-bars view, on the look-ahead by default', async ({ page }) => {
  await expect(page.locator('.toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Activity' })).toHaveCount(0);
  await expect(page.getByLabel('Show')).toHaveValue('la:3');
  await expect(page.locator('.nm-ph-head').first()).toContainText('In progress');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/60-phone-lookahead.png` });
  // Every row is a button with a spoken summary; no row is draggable or editable.
  const row = page.locator('.nm-ph-row').first();
  await expect(row).toHaveAttribute('aria-label', /, (In progress|Not started)/);
  await expect(page.locator('.nm-ph-row [contenteditable], .nm-ph-row input')).toHaveCount(0);
});

test('tap a row for details; follow a predecessor; close with Escape', async ({ page }) => {
  const row = page.locator('.nm-ph-row').filter({ hasText: 'Slab' }).first();
  const name = (await row.locator('.nm-ph-name').evaluate((el) => el.firstChild?.textContent ?? ''));
  await expect(row.locator('.nm-ph-name small')).toHaveText(/· Tower [AB] · Floor \d+/);
  await row.tap();
  const sheet = page.getByRole('dialog');
  await expect(sheet.locator('h2')).toHaveText(name);
  await expect(sheet).toContainText('Dates');
  await expect(sheet).toContainText('Total float');
  await expect(sheet).toContainText('View only');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/61-phone-details.png` });
  const pred = sheet.getByRole('heading', { name: 'Predecessors' }).locator('xpath=..').getByRole('button').first();
  const predName = (await pred.textContent())!.replace(/\s+(FS|SS|FF|SF).*$/, '');
  await pred.tap();
  await expect(sheet.locator('h2')).toHaveText(predName);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('switch to one tower; floors appear as groups; hide finished work', async ({ page }) => {
  await page.getByLabel('Show').selectOption({ label: 'Tower A' });
  await expect(page.locator('.nm-ph-head').filter({ hasText: 'Floor 1' }).first()).toBeVisible();
  const all = Number((await page.locator('.nm-ph-sub span').first().textContent())!.replace(/\D/g, ''));
  await page.getByLabel('Hide done').check();
  const left = Number((await page.locator('.nm-ph-sub span').first().textContent())!.replace(/\D/g, ''));
  expect(left).toBeLessThan(all);
  expect(left).toBeGreaterThan(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/62-phone-tower.png` });
});

test('pinch out zooms the bars in; the buttons and Fit work too', async ({ page }) => {
  await page.getByLabel('Show').selectOption({ label: 'Tower A' });
  await page.waitForSelector('.nm-ph-fill');
  const before = await firstBarWidth(page);

  // Two-finger pinch, spreading apart, over the list.
  const box = (await page.locator('.nm-ph-scroll').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + 200;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, d: number) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }],
  });
  await touch('touchStart', 30);
  for (let d = 40; d <= 150; d += 10) await touch('touchMove', d);
  await touch('touchEnd', 0);
  const pinched = await firstBarWidth(page);
  expect(pinched).toBeGreaterThan(before * 2);

  await page.getByRole('button', { name: 'Fit' }).tap();
  expect(Math.abs((await firstBarWidth(page)) - before)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Zoom in' }).tap();
  expect(await firstBarWidth(page)).toBeGreaterThan(before * 1.4);
  // A pinch never opens the details sheet.
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Hindi labels', async ({ page }) => {
  await page.getByRole('button', { name: 'Language' }).tap();
  await expect(page.locator('.nm-ph-head').first()).toContainText('प्रगति में');
});

});

test.describe('desktop', () => {
  test('the Phone tab previews the phone view; ?view=phone forces it', async ({ page }) => {
    await page.goto('/?view=desktop');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/?view=desktop');
    await page.getByRole('tab', { name: 'Phone' }).click();
    await expect(page.getByLabel('Phone preview').locator('.nm-ph-row').first()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/63-phone-tab.png` });
    await page.goto('/?view=phone');
    await expect(page.locator('.toolbar')).toHaveCount(0);
    await expect(page.locator('.nm-phone')).toBeVisible();
  });
});
