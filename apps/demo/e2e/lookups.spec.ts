import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SHOT_DIR;

async function blankProjectWithActivity(page: Page, name: string) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('.nm-bar-g');
  await page.getByRole('button', { name: '+ New project' }).click();
  const dlg = page.getByRole('dialog', { name: 'New project' });
  await dlg.getByLabel('Project name').fill('Kaveri');
  await dlg.getByText('Blank', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: '+ Activity' }).click();
  await page.locator('.nm-cell-input').fill(name);
  await page.locator('.nm-cell-input').press('Enter');
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));
}

const openEditor = async (page: Page, name: string) => {
  await page.locator('.nm-tr', { hasText: name }).locator('.col-wbs').dblclick();
  return page.getByRole('dialog', { name: new RegExp(name) });
};

test('in a blank project, add a tower, floor and trade from the editor; the activity lands on the grid; undo removes it all', async ({ page }) => {
  await blankProjectWithActivity(page, 'Slab pour');
  const ed = await openEditor(page, 'Slab pour');
  await ed.getByLabel('Tower', { exact: true }).selectOption({ label: '+ Add tower…' });
  await ed.getByLabel('New tower name').fill('Tower A');
  await ed.getByLabel('Floor', { exact: true }).selectOption({ label: '+ Add floor…' });
  await ed.getByLabel('New floor name').fill('Floor 1');
  await ed.getByLabel('Trade', { exact: true }).selectOption({ label: 'Slab shuttering, rebar & pour' });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/70-editor-lookups.png` });
  await ed.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));

  // The new tower is now a choice everywhere.
  await expect(page.getByLabel('Tower', { exact: true }).locator('option')).toHaveText(['All', 'Tower A']);
  const ed2 = await openEditor(page, 'Slab pour');
  await expect(ed2.getByLabel('Tower', { exact: true })).toHaveValue('T-TOWER-A');
  await expect(ed2.getByLabel('Floor', { exact: true }).locator('option')).toHaveText(['—', 'Floor 1', '+ Add floor…']);
  await ed2.getByRole('button', { name: 'Cancel' }).click();

  // One undo reverses the whole save (tags and the new tower and floor); redo brings it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));
  await expect(page.getByLabel('Tower', { exact: true }).locator('option')).toHaveText(['All']);
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));
  await expect(page.getByLabel('Tower', { exact: true }).locator('option')).toHaveText(['All', 'Tower A']);

  await page.getByRole('tab', { name: 'Tower × floor' }).click();
  await expect(page.locator('.nmc-tower')).toHaveCount(1);
  await expect(page.locator('.nmc-tower .nmc-floor')).toHaveText(['Floor 1']);
  await expect(page.locator('.nmc-cell:not(.empty)')).toHaveCount(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/71-grid-from-blank.png` });
});

test('the setup dialog adds towers and a floor range, renames a trade, and refuses to remove what is in use', async ({ page }) => {
  await blankProjectWithActivity(page, 'Columns F1');
  await page.getByRole('button', { name: 'Towers, floors & trades…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Towers, floors & trades' });
  await dlg.getByRole('button', { name: '+ Add tower…' }).click();
  await dlg.getByLabel('Towers 1 Name').fill('Kaveri A');
  await dlg.getByRole('button', { name: '+ Add tower…' }).click();
  await dlg.getByLabel('Towers 2 Name').fill('Kaveri B');
  await dlg.getByLabel('Add floors to').fill('12');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dlg.getByRole('region', { name: 'Floors, bottom to top' }).locator('li')).toHaveCount(12);
  await dlg.getByLabel('Trades, in construction order 1 Name').fill('Columns');
  await dlg.getByRole('button', { name: 'Move down: Columns' }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/72-setup.png` });
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));

  const ed = await openEditor(page, 'Columns F1');
  await expect(ed.getByLabel('Tower', { exact: true }).locator('option')).toHaveText(['—', 'Kaveri A', 'Kaveri B', '+ Add tower…']);
  await expect(ed.getByLabel('Floor', { exact: true }).locator('option')).toHaveCount(14);
  await expect(ed.getByLabel('Trade', { exact: true }).locator('option').nth(2)).toHaveText('Columns');
  await ed.getByLabel('Tower', { exact: true }).selectOption({ label: 'Kaveri A' });
  await ed.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));

  await page.getByRole('button', { name: 'Towers, floors & trades…' }).click();
  const again = page.getByRole('dialog', { name: 'Towers, floors & trades' });
  await expect(again.getByRole('button', { name: 'Remove: Kaveri A' })).toBeDisabled();
  await expect(again.getByRole('button', { name: 'Remove: Kaveri B' })).toBeEnabled();
  await expect(again.getByText('1 activities')).toBeVisible();
});

test('undo history survives switching tabs, and is separate per project', async ({ page }) => {
  await blankProjectWithActivity(page, 'Blockwork F2');
  const ed = await openEditor(page, 'Blockwork F2');
  await ed.getByLabel('Tower', { exact: true }).selectOption({ label: '+ Add tower…' });
  await ed.getByLabel('New tower name').fill('Tower A');
  await ed.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));

  // Away and back: the Gantt is rebuilt, the history is not.
  await page.getByRole('tab', { name: 'Tower × floor' }).click();
  await page.getByRole('tab', { name: 'Line of balance' }).click();
  await page.getByRole('tab', { name: 'Gantt' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));
  await expect(page.getByLabel('Tower', { exact: true }).locator('option')).toHaveText(['All']);
  await page.getByRole('tab', { name: 'Look-ahead' }).click();
  await page.getByRole('tab', { name: 'Gantt' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.waitForFunction(() => !document.querySelector('.nm-status.saving'));
  await expect(page.getByLabel('Tower', { exact: true }).locator('option')).toHaveText(['All', 'Tower A']);

  // Another project has its own (empty) history: undo there changes nothing here.
  await page.getByLabel('Schedule', { exact: true }).selectOption('sample');
  await page.waitForSelector('.nm-bar-g');
  const before = await page.locator('.stats').textContent();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.stats')).toHaveText(before!);
});
