import { test, expect, openPreparation } from './weekly-fixtures';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
const week = startOfWeek(todayDay());
const day = (offset: number) =>
  new Date(addDays(week, offset) + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
async function recipe(page: any, query = 'curry', name = /Chickpea & spinach curry/) {
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill(query);
  await page.getByRole('option', { name }).click();
}

test('cook from a chosen meal slot with autocomplete, simple dates and no duplicate meal picker', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Add dinner on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Cook something/ }).click();
  await expect(page.locator('input[type=date]:visible')).toHaveCount(0);
  await recipe(page);
  await expect(
    page.getByRole('button', { name: `Cooking day: ${day(1)}`, exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Choose meals' })).toHaveCount(0);
  await page.getByRole('button', { name: `Cooking day: ${day(0)}`, exact: true }).click();
  await page.getByLabel('Add ingredients to shopping list').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.wp-meal')).toHaveCount(1);
  await expect(page.locator('.wp-meal img')).toHaveCount(1);
  await expect(page.locator('.wp-day').nth(1).locator('.wp-meal')).toHaveCount(1);
  await page.reload();
  await openPreparation(page);
  await expect(page.locator('.wp-meal')).toHaveCount(1);
  for (let i = 0; i < 7; i++)
    await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(page.locator('.wp-meal')).toHaveCount(0);
  await page.getByRole('button', { name: /Recipes/ }).click();
  await expect(page.locator('.wp-recipe')).toHaveCount(4);
});

test('cook starts unplaced and editing keeps its agenda placement', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await recipe(page);
  await page.getByRole('button', { name: `Cooking day: ${day(0)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.wp-meal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
  await page.getByRole('button', { name: /Chickpea & spinach curry.*portions available/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit cooking Chickpea & spinach curry', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /^Cooking day:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page
      .locator('.wp-day')
      .nth(1)
      .getByRole('button', { name: 'Edit Chickpea & spinach curry', exact: true })
  ).toBeVisible();
});

test('batch shopping scales but individual meal and shopping edits survive saves', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await recipe(page);
  await page.getByLabel('Add ingredients to shopping list').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Add dinner on Wednesday', exact: true }).click();
  await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
  await page.getByRole('button', { name: /Chickpea & spinach curry.*portions available/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Chickpea & spinach curry', exact: true }).click();
  await page.getByLabel('Meal name', { exact: true }).fill('Curry with naan');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: /^Shopping/ }).click();
  await page.getByRole('button', { name: 'Edit shopping 2 tins chickpeas', exact: true }).click();
  await page.getByLabel('Edit shopping item').fill('2 tins chickpeas – low sodium');
  await page.getByRole('button', { name: 'Save shopping edit' }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit cooking Chickpea & spinach curry', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Makes (portions)', exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit Curry with naan', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Shopping/ }).click();
  await expect(
    page.getByRole('checkbox', { name: '600 ml coconut milk', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: '2 tins chickpeas – low sodium', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: '400 ml coconut milk', exact: true })
  ).toHaveCount(0);
});

test('custom recipes and natural quantities are maintained across weeks', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: /Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Bean stew');
  await page.getByText('Paste ingredient lines', { exact: true }).click();
  await page
    .getByLabel('Ingredients', { exact: true })
    .fill('1 onion\n2 tins beans\n½ lemon\n2 1/2 cups stock');
  await page.getByRole('button', { name: 'Add pasted ingredients', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .locator('.wp-recipe')
    .filter({ hasText: 'Bean stew' })
    .getByRole('button', { name: 'Plan a cook', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Makes (portions)', exact: true }).fill('8');
  await page.getByLabel('Add ingredients to shopping list').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /^Shopping/ }).click();
  for (const name of ['2 onion', '4 tins beans', '1 lemon', '5 cups stock'])
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await openPreparation(page);
  for (let i = 0; i < 7; i++)
    await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await recipe(page, 'bean', /Bean stew/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.wp-meal')).toHaveCount(0);
});

test('responsive page and cooking controls have no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await recipe(page);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  const sizes = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: innerWidth,
    dialog: document.querySelector('dialog[open]')!.scrollWidth,
    box: document.querySelector('dialog[open]')!.clientWidth
  }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.dialog).toBeLessThanOrEqual(sizes.box + 1);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
});

test('linked meal edits keep agenda placement and cannot exceed remaining portions', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await recipe(page);
  await page.getByRole('button', { name: `Cooking day: ${day(2)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Add dinner on Wednesday', exact: true }).click();
  await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
  await page.getByRole('button', { name: /Chickpea & spinach curry.*portions available/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Chickpea & spinach curry', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Day:/ })).toHaveCount(0);
  await expect(
    page.getByRole('spinbutton', { name: 'Portions for this meal', exact: true })
  ).toHaveAttribute('max', '4');
  await page.getByRole('spinbutton', { name: 'Portions for this meal', exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page
      .locator('.wp-day')
      .nth(2)
      .getByRole('button', { name: 'Edit Chickpea & spinach curry', exact: true })
  ).toBeVisible();
});
