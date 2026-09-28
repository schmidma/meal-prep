import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const recipes = (page: Page) => page.getByRole('dialog', { name: 'Recipes' });
async function createRecipe(page: Page, name: string) {
  const popup = recipes(page);
  await popup.getByLabel('New recipe name').fill(name);
  await popup.getByRole('button', { name: 'Add recipe' }).click();
  await expect(popup.getByLabel('Recipe name')).toHaveValue(name);
}

test('ingredient entry drafts stay per recipe across Checks and only Add saves and clears the matching draft', async ({
  page
}) => {
  const writes: string[] = [];
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() === 'PUT') writes.push(route.request().postData() ?? '');
    await route.fallback();
  });
  await page.goto('/');
  await page
    .locator('.heading-actions')
    .getByRole('button', { name: 'Recipes', exact: true })
    .click();
  await createRecipe(page, 'Chickpea curry');
  const entry = recipes(page).getByLabel('Add Recipe ingredient', { exact: true });
  await entry.fill('2 cumin');
  await recipes(page)
    .getByRole('navigation', { name: 'Inspector' })
    .getByRole('button', { name: /Checks/ })
    .click();
  await page
    .getByRole('dialog', { name: 'Things to check' })
    .getByRole('navigation', { name: 'Inspector' })
    .getByRole('button', { name: 'Recipes' })
    .click();
  await expect(recipes(page).getByLabel('Recipe name')).toHaveValue('Chickpea curry');
  await expect(entry).toHaveValue('2 cumin');
  await recipes(page).getByRole('button', { name: 'All recipes' }).click();
  await createRecipe(page, 'Lentil stew');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const before = writes.length;
  await expect(entry).toHaveValue('');
  await entry.fill('3 paprika');
  await recipes(page).getByRole('button', { name: 'All recipes' }).click();
  await recipes(page)
    .getByRole('button', { name: /Chickpea curry/ })
    .click();
  await expect(entry).toHaveValue('2 cumin');
  await expect(recipes(page).getByText('cumin', { exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(before);
  await recipes(page).getByRole('button', { name: 'Add Recipe ingredient row' }).click();
  await expect(entry).toHaveValue('');
  await expect(recipes(page).getByLabel('Recipe ingredient 1 name')).toHaveValue('cumin');
  await expect.poll(() => writes.length).toBeGreaterThan(before);
  await recipes(page).getByRole('button', { name: 'All recipes' }).click();
  await recipes(page)
    .getByRole('button', { name: /Lentil stew/ })
    .click();
  await expect(entry).toHaveValue('3 paprika');
  await expect(recipes(page).getByLabel('Recipe ingredient 1 name')).toHaveCount(0);
});
