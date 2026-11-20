import { expect, test } from '@playwright/test';

const SHOTS = process.env.SHOT_DIR;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('.nm-bar-g');
});

test('create a blank project, add an activity, and it persists after reload', async ({ page }) => {
  await page.getByRole('button', { name: '+ New project' }).click();
  const dlg = page.getByRole('dialog', { name: 'New project' });
  await dlg.getByLabel('Project name').fill('Sector 21 residences');
  await dlg.getByLabel('Start date').fill('2027-02-01');
  await dlg.getByText('Blank', { exact: true }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/40-new-project.png` });
  await dlg.getByRole('button', { name: 'Create project' }).click();
  await expect(page.locator('.brand strong')).toHaveText('Sector 21 residences');
  await expect(page.locator('.nm-tr')).toHaveCount(0);
  await page.getByRole('button', { name: '+ Activity' }).click();
  await page.locator('.nm-cell-input').fill('Site survey');
  await page.locator('.nm-cell-input').press('Enter');
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));
  await expect(page.locator('.nm-tr .col-name .nm-cell-text')).toHaveText(['Site survey']);
  await expect(page.locator('.nm-tr .col-start .nm-cell-text')).toHaveText('01 Feb 27');
  await page.reload();
  await page.waitForSelector('.nm-tr');
  await expect(page.locator('.brand strong')).toHaveText('Sector 21 residences');
  await expect(page.locator('.nm-tr .col-name .nm-cell-text')).toHaveText(['Site survey']);
  await expect(page.getByLabel('Schedule', { exact: true }).locator('optgroup[label="Your projects"] option')).toHaveText(['Sector 21 residences']);
});

test('create a tower project; it drives the construction views; delete it', async ({ page }) => {
  await page.getByRole('button', { name: '+ New project' }).click();
  const dlg = page.getByRole('dialog', { name: 'New project' });
  await dlg.getByLabel('Project name').fill('Twin towers phase 2');
  await dlg.getByLabel('Towers').fill('3');
  await dlg.getByLabel('Floors per tower').fill('8');
  await dlg.getByRole('button', { name: 'Create project' }).click();
  await expect(page.locator('.brand strong')).toHaveText('Twin towers phase 2');
  await page.waitForSelector('.nm-bar-g');
  await page.getByRole('tab', { name: 'Tower × floor' }).click();
  await expect(page.locator('.nmc-tower')).toHaveCount(3);
  await expect(page.locator('.nmc-tower').first().locator('.nmc-floor').first()).toHaveText('Floor 8');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/41-new-tower-project.png` });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.locator('.brand strong')).toHaveText('Residential towers A & B');
  await expect(page.getByLabel('Schedule', { exact: true }).locator('optgroup[label="Your projects"]')).toHaveCount(0);
});

test('the dialog validates the name', async ({ page }) => {
  await page.getByRole('button', { name: '+ New project' }).click();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('alert')).toContainText('name');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New project' })).toHaveCount(0);
});
