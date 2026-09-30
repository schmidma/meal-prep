import { test, expect, openPreparation } from './weekly-fixtures';

test('cooking and leftovers share compact headers and recipe-owned photos', async ({
  page
}, info) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Cooking day:/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Close/ })).toHaveCount(0);
  await expect(
    page.locator('.wp-food-dialog-header').getByRole('combobox', { name: 'Meal name' })
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill('Roasted tomato soup');
  await page.getByRole('option', { name: /Roasted tomato soup/ }).click();
  await expect(page.getByRole('button', { name: 'Change image', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit cooking Roasted tomato soup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit cooking plan' })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Meal name', exact: true })).not.toBeFocused();
  await expect(page.getByRole('button', { name: /^Cooking day:/ })).toHaveCount(0);
  await expect(page.getByRole('listbox', { name: 'Matching recipes' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).press('ArrowDown');
  await expect(page.getByRole('option', { name: /Roasted tomato soup/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').screenshot({ path: `/tmp/compact-cook-${info.project.name}.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Change image', exact: true })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Leftover name', exact: true })
    .fill('Roasted tomato soup');
  await page.getByRole('option', { name: /Roasted tomato soup/ }).click();
  await expect(page.getByRole('button', { name: 'Change image', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await openPreparation(page);
  await page
    .getByRole('button', { name: 'Edit leftovers Roasted tomato soup', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Change image', exact: true })).toHaveCount(0);
  await page
    .getByRole('dialog')
    .screenshot({ path: `/tmp/compact-leftover-${info.project.name}.png` });
  await expect(
    page.getByRole('combobox', { name: 'Leftover name', exact: true })
  ).not.toBeFocused();
  await page.getByRole('combobox', { name: 'Leftover name', exact: true }).fill('My soup');
  await page.getByRole('button', { name: 'Change image', exact: true }).click();
  await page.getByRole('button', { name: 'Use Vegetables illustration', exact: true }).click();
  await page.getByRole('button', { name: 'Back to details', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit leftovers My soup', exact: true }).locator('img')
  ).toHaveAttribute('src', '/images/illustrations/vegetables.webp');
});

test('meal source photos, linked-meal removal choices, modal scrolling and toast expiry', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
  await expect(page.getByRole('button', { name: 'Change image', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add dinner on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Cook something/ }).click();
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill('Roasted tomato soup');
  await page.getByRole('option', { name: /Roasted tomato soup/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.wp-meal')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit cooking Roasted tomato soup', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Remove cooking plan?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Keep meals', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.wp-meal')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Edit cooking Roasted tomato soup', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Remove meals too', exact: true }).click();
  await expect(page.locator('.wp-meal')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
  await expect(page.locator('.wp-toast')).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(page.locator('.wp-toast')).toHaveCount(0, { timeout: 9000 });
});

test('discard edits uses an app dialog and restores the editor on cancel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await page.getByLabel('Name', { exact: true }).fill('Unsaved recipe');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Discard changes?' });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Unsaved recipe');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('new meal focuses its name, duplicates in place and offers another meal in an occupied slot', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Something else/ }).click();
  await expect(page.getByRole('textbox', { name: 'Meal name', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: 'Meal name', exact: true }).fill('Lunch out');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Lunch out', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meal name', exact: true })).not.toBeFocused();
  await page.getByRole('button', { name: 'Duplicate meal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Lunch out', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a meal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('leftover portions are capped and deletion offers linked meal choices', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('combobox', { name: 'Leftover name', exact: true }).fill('Extra soup');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
  await page.getByRole('button', { name: /Extra soup.*portions ready/ }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Portions for this meal', exact: true })
  ).toHaveAttribute('max', '2');
  await expect(
    page.getByRole('button', { name: 'Increase portions for this meal', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await openPreparation(page);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove leftovers Extra soup', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await page.getByRole('button', { name: 'Remove leftovers Extra soup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep meals', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove meals too', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Extra soup', exact: true })).toHaveCount(0);
});
