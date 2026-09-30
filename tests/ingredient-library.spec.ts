import { test, expect, openPreparation } from './weekly-fixtures';

test('ingredient aliases connect recipes, use soon and shopping across reload', async ({
  page
}, info) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('combobox', { name: 'Ingredient to use soon' }).fill('garbanzo');
  await page.getByRole('option', { name: /chickpeas/ }).click();
  await expect(page.getByRole('combobox', { name: 'Ingredient to use soon' })).toHaveValue('');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Chickpea salad');
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Ingredient 1', exact: true })
    .fill('2 tins garbanzo, drained');
  await page.getByRole('option', { name: /chickpeas/ }).click();
  await page.screenshot({ path: `/tmp/ingredient-editor-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search recipes' }).fill('garbanzo');
  await expect(
    page.getByRole('button', { name: 'Edit recipe Chickpea salad', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Manage ingredients' }).click();
  await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('garbanzo');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /chickpeas chickpea/ })
    .click();
  await page.getByLabel('Preferred name').fill('Chick peas');
  await page.getByLabel('Other names').fill('chickpeas\ngarbanzo beans');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove ingredient Chick peas', exact: true })
  ).toBeVisible();
  await page.reload();
  await openPreparation(page);
  await page.getByRole('button', { name: /^Shopping/ }).click();
  await page.getByRole('combobox', { name: 'Shopping item', exact: true }).fill('2 tins garbanzo');
  await page.getByRole('option', { name: /Chick peas/ }).click();
  await page.getByRole('button', { name: 'Add shopping item' }).click();
  await expect(
    page.getByRole('checkbox', { name: '2 tins Chick peas', exact: true })
  ).toBeVisible();
});

test('merging a duplicate keeps references and aliases', async ({ page }, info) => {
  await page.goto('/');
  await openPreparation(page);
  for (const name of ['Courgette', 'Summer squash']) {
    await page.getByRole('combobox', { name: 'Ingredient to use soon' }).fill(name);
    await page.getByRole('button', { name: 'Add use-soon ingredient' }).click();
  }
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Manage ingredients' }).click();
  await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('Summer squash');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Summer squash', exact: true })
    .click();
  await page.getByText('Merge duplicate ingredient', { exact: true }).click();
  await page.getByLabel('Keep ingredient').selectOption({ label: 'courgette' });
  await page.screenshot({ path: `/tmp/ingredient-merge-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Merge ingredients', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.wp-use-soon-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.wp-use-soon-list li')).toHaveCount(2);
});

test('recipe writing keeps keyboard entries and pasted ingredients when saving', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Simple greens');
  await page.getByRole('combobox', { name: 'Ingredient 1', exact: true }).fill('200g spin');
  await page.getByRole('option', { name: /spinach/ }).click();
  await page.getByRole('combobox', { name: 'Ingredient 1', exact: true }).press('Enter');
  await expect(page.getByRole('combobox', { name: 'Ingredient 2', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'Ingredient 2', exact: true }).fill('salt, to taste');
  await page.getByText('Paste ingredient lines', { exact: true }).click();
  await page.getByLabel('Ingredients', { exact: true }).fill('1 lemon');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit recipe Simple greens', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ingredient 1', exact: true })).toHaveValue(
    '200 g spinach'
  );
  await expect(page.getByRole('combobox', { name: 'Ingredient 2', exact: true })).toHaveValue(
    'salt, to taste'
  );
  await expect(page.getByRole('combobox', { name: 'Ingredient 3', exact: true })).toHaveValue(
    '1 lemon'
  );
});

test('ingredients can be added without secure-context UUID support', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('combobox', { name: 'Ingredient to use soon' }).fill('Kohlrabi');
  await page.getByRole('button', { name: 'Add use-soon ingredient' }).click();
  await expect(
    page.getByRole('button', { name: 'Remove ingredient Kohlrabi', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Ethernet salad');
  await page.getByRole('combobox', { name: 'Ingredient 1', exact: true }).fill('1 kohlrabi');
  await page.getByRole('option', { name: 'Kohlrabi', exact: true }).click();
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await page.getByRole('combobox', { name: 'Ingredient 2', exact: true }).fill('2 carrots');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit recipe Ethernet salad', exact: true }).click();
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await page.getByRole('combobox', { name: 'Ingredient 3', exact: true }).fill('1 lemon');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Edit recipe Ethernet salad', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Ingredient 3', exact: true })).toHaveValue(
    '1 lemon'
  );
});
