import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHOTS = process.env.SHOT_DIR;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('.nm-bar-g');
});

const stat = (page: import('@playwright/test').Page, label: string) => page.locator('.stats span', { hasText: label }).locator('b');

test('export the sample to Excel, import it back as a new project, same schedule', async ({ page }) => {
  const finish = await stat(page, 'project finish').textContent();
  const links = await stat(page, 'links').textContent();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByLabel('Export', { exact: true }).selectOption('xlsx')]);
  expect(download.suggestedFilename()).toBe('Residential towers A & B.xlsx');
  const file = join(tmpdir(), `nm-export-${Date.now()}.xlsx`);
  await download.saveAs(file);

  await page.getByLabel('Import file').setInputFiles(file);
  const dlg = page.getByRole('dialog', { name: /Import Excel/ });
  await expect(dlg.getByLabel('Import summary')).toContainText('215 activities');
  await expect(dlg.getByLabel('Import summary')).toContainText('0 errors');
  await expect(dlg.getByText(/Calculated columns ignored/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/50-import-preview.png` });
  await dlg.getByLabel('Project name').fill('Round trip');
  await dlg.getByRole('button', { name: 'Create project' }).click();

  await expect(page.locator('.brand strong')).toHaveText('Round trip');
  await expect(stat(page, 'activities')).toHaveText('215');
  await expect(stat(page, 'links')).toHaveText(links!);
  await expect(stat(page, 'project finish')).toHaveText(finish!);
});

test('cancelling the import preview creates nothing', async ({ page }) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByLabel('Export', { exact: true }).selectOption('template')]);
  expect(download.suggestedFilename()).toBe('nm-schedule-template.xlsx');
  const file = join(tmpdir(), `nm-template-${Date.now()}.xlsx`);
  await download.saveAs(file);
  await page.getByLabel('Import file').setInputFiles(file);
  const dlg = page.getByRole('dialog', { name: /Import Excel/ });
  await expect(dlg.getByLabel('Import summary')).toContainText('6 activities');
  await expect(dlg.getByLabel('Import summary')).toContainText('4 links');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByLabel('Schedule', { exact: true }).locator('optgroup[label="Your projects"]')).toHaveCount(0);

  // Import it for real: the template becomes a linked, calculated project.
  await page.getByLabel('Import file').setInputFiles(file);
  await page.getByRole('dialog', { name: /Import Excel/ }).getByRole('button', { name: 'Create project' }).click();
  await expect(page.locator('.nm-tr .col-name .nm-cell-text')).toHaveText(['Tower A', 'Site mobilisation', 'Excavation', 'Raft foundation', 'Floor 1 slab', 'Tower A handover']);
});

test('a file that is not a workbook gives a readable error', async ({ page }) => {
  const file = join(tmpdir(), `nm-bad-${Date.now()}.xlsx`);
  writeFileSync(file, 'Name,Code\nA,B\n');
  await page.getByLabel('Import file').setInputFiles(file);
  await expect(page.getByRole('region', { name: 'Import report' })).toContainText('Not an Excel .xlsx file');
});
