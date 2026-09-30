import { test, expect, openPreparation } from './weekly-fixtures';

test('recipe image opens editor and use-soon reminder follows the ingredient list', async ({
  page
}, info) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('combobox', { name: 'Ingredient to use soon' }).fill('Tomato');
  await page.getByRole('button', { name: 'Add use-soon ingredient', exact: true }).click();
  await page.screenshot({ path: `/tmp/card-agenda-${info.project.name}.png` });
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await expect(page.locator('.wp-recipe-use-soon')).toContainText(/tomato/i);
  await page.getByRole('checkbox', { name: 'Matching recipes only' }).check();
  const recipe = page.getByRole('button', { name: /Edit recipe/ }).first();
  await expect(recipe).toBeVisible();
  await recipe.hover();
  await expect(page.locator('.wp-recipe').first()).toHaveCSS(
    'background-color',
    'rgb(237, 242, 232)'
  );
  await page.screenshot({ path: `/tmp/card-recipes-${info.project.name}.png` });
  await recipe.locator('img').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Change image', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Illustrations' }).getByRole('button')).toHaveCount(
    12
  );
  await expect(page.getByText('Method', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to details', exact: true }).click();
  await expect(page.getByText('Method', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});
