import { test, expect, openPreparation } from './weekly-fixtures';

test('removing the last use-soon ingredient clears its recipe filter', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('combobox', { name: 'Ingredient to use soon' }).fill('spinach');
  await page.getByRole('option', { name: 'spinach', exact: true }).click();
  await page.getByRole('button', { name: /^Recipes/ }).click();
  const count = await page.locator('.wp-recipe').count();
  await page.getByRole('checkbox', { name: 'Matching recipes only' }).check();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await openPreparation(page);
  const remove = page
    .locator('.wp-use-soon-list')
    .getByRole('button', { name: /^Remove ingredient/ });
  while (await remove.count()) await remove.first().click();
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await expect(page.locator('.wp-recipe')).toHaveCount(count);
  await expect(page.getByRole('checkbox', { name: 'Matching recipes only' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await openPreparation(page);
  await page.getByRole('combobox', { name: 'Ingredient to use soon' }).fill('spinach');
  await page.getByRole('option', { name: 'spinach', exact: true }).click();
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Matching recipes only' })).not.toBeChecked();
  await expect(page.locator('.wp-recipe')).toHaveCount(count);
});

test('ingredient suggestions become removable AND filters by click or Enter', async ({
  page
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  const search = page.getByRole('combobox', { name: 'Search recipes', exact: true });
  await search.fill('garbanzo');
  await expect(page.getByRole('option', { name: /chickpeas/ })).toBeVisible();
  await page.getByRole('option', { name: /chickpeas/ }).click();
  await expect(search).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Remove chickpeas filter', exact: true })
  ).toBeVisible();
  await expect(page.locator('.wp-recipe')).toHaveCount(2);
  await search.fill('spin');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Remove spinach filter', exact: true })
  ).toBeVisible();
  await expect(page.locator('.wp-recipe')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Edit recipe Chickpea & spinach curry', exact: true })
  ).toBeVisible();
  await page.screenshot({ path: `/tmp/recipe-filters-${info.project.name}.png` });
  await search.fill('garbanzo beans');
  await search.press('Enter');
  await expect(
    page.getByRole('group', { name: 'Ingredient filters' }).getByRole('button')
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove chickpeas filter', exact: true }).click();
  await expect(page.locator('.wp-recipe')).toHaveCount(2);
  await search.fill('tomato');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'No recipes found', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove tomato filter', exact: true }).click();
  await page.getByRole('button', { name: 'Remove spinach filter', exact: true }).click();
  await expect(page.locator('.wp-recipe')).toHaveCount(4);
  await search.fill('Roasted tomato soup');
  await expect(page.locator('.wp-recipe')).toHaveCount(1);
});

test('toast countdown pauses and restarts for a replacement notification', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.clock.install();
  const input = page.getByRole('combobox', { name: 'Ingredient to use soon' });
  await input.fill('Radicchio');
  await page.getByRole('button', { name: 'Add use-soon ingredient' }).click();
  await page.mouse.move(0, 0);
  const bar = page.locator('.wp-toast-countdown');
  await expect(bar).toBeVisible();
  await page.clock.fastForward(3000);
  const remaining = await bar.evaluate((el) =>
    Number(getComputedStyle(el).transform.split('(')[1].split(',')[0])
  );
  expect(remaining).toBeGreaterThan(0.3);
  expect(remaining).toBeLessThan(0.6);
  await page.locator('.wp-toast').hover();
  await page.clock.fastForward(8000);
  await expect(bar).toBeVisible();
  const paused = await bar.getAttribute('style');
  await page.clock.fastForward(2000);
  await expect(bar).toHaveAttribute('style', paused!);
  await page.mouse.move(0, 0);
  await input.fill('Watercress');
  await page.getByRole('button', { name: 'Add use-soon ingredient' }).click();
  await page.mouse.move(0, 0);
  await expect(page.locator('.wp-toast')).toHaveCount(1);
  await page.clock.fastForward(4000);
  await expect(bar).toBeVisible();
  await page.clock.fastForward(2200);
  await expect(page.locator('.wp-toast')).toHaveCount(0);
});

test('clear filters and create from an empty search; recipe editor can plan without leaving recipes', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  const search = page.getByRole('combobox', { name: 'Search recipes', exact: true });
  await search.fill('Mushroom risotto');
  await page.getByRole('button', { name: 'Create “Mushroom risotto”', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    'Mushroom risotto'
  );
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(search).toHaveValue('');
  await page.getByRole('button', { name: 'Edit recipe Mushroom risotto', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recipes', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit recipe Mushroom risotto', exact: true })
  ).toBeVisible();
});

test('cooking suggestions include all recipes, beyond the first six', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  for (const name of ['Apple salad', 'Bean soup', 'Carrot pie']) {
    await page.getByRole('button', { name: 'Add a recipe', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await openPreparation(page);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Meal name', exact: true })).toBeFocused();
  await expect(
    page.getByRole('listbox', { name: 'Matching recipes' }).getByRole('option')
  ).toHaveCount(7);
  await page.getByRole('option', { name: /Carrot pie/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
});
