import { test, expect, openPreparation } from './weekly-fixtures';
import { todayDay } from '../src/lib/calendar';
test('settings customize and persist the planning view and sections', async ({
  page
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Start planning from').selectOption('today');
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).fill('10');
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).blur();
  await page.getByRole('spinbutton', { name: 'Portions per meal', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Portions per meal', exact: true }).blur();
  await page.getByLabel('Show Breakfast', { exact: true }).check();
  await page.getByLabel('Custom section name').fill('Teatime');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await expect(page.getByLabel('Show Teatime', { exact: true })).toBeChecked();
  await page.screenshot({ path: `/tmp/settings-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.wp-day')).toHaveCount(10);
  await expect(page.locator('.wp-day').first()).toHaveAttribute('id', `day-${todayDay()}`);
  await expect(
    page.locator('.wp-day').first().getByRole('group', { name: 'Teatime', exact: true })
  ).toBeVisible();
  await page.screenshot({ path: `/tmp/sections-${testInfo.project.name}.png`, fullPage: true });
  await page.reload();
  await expect(page.locator('.wp-day')).toHaveCount(10);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Portions per meal', exact: true })
  ).toHaveValue('3');
  await page.getByLabel('Section name Teatime', { exact: true }).fill('Snack');
  await page.getByLabel('Section name Teatime', { exact: true }).blur();
  await page.getByRole('heading', { name: 'Meal sections', exact: true }).click();
  await page.getByLabel('Show Snack', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Snack', exact: true })).toHaveCount(0);
});

test('custom section keeps its meals through rename, reorder, disabling and reload', async ({
  page
}) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Custom section name').fill('Teatime');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByLabel('Days shown')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add teatime on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Cook something/ }).click();
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill('Toast');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page
      .getByRole('group', { name: 'Teatime', exact: true })
      .getByRole('button', { name: 'Edit Toast', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Section name Teatime', { exact: true }).fill('Snack');
  await page.getByLabel('Section name Teatime', { exact: true }).blur();
  await page.getByRole('button', { name: 'Move Snack up', exact: true }).click();
  await page.getByLabel('Show Snack', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(
    page
      .getByRole('group', { name: 'Snack', exact: true })
      .getByRole('button', { name: 'Edit Toast', exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'Snack', exact: true })
      .getByRole('button', { name: 'Edit Toast', exact: true })
  ).toBeVisible();
  await openPreparation(page);
  await page.getByRole('button', { name: 'Edit cooking Toast', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page
      .getByRole('group', { name: 'Snack', exact: true })
      .getByRole('button', { name: 'Edit Toast', exact: true })
  ).toBeVisible();
});

test('number steppers, intact input focus and selected page survive reload', async ({ page }) => {
  await page.goto('/');
  for (const section of ['Recipes', 'Shopping', 'Settings']) {
    await page.getByRole('button', { name: new RegExp(`^${section}`) }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(`^${section}`) })).toHaveClass(
      /active/
    );
  }
  const days = page.getByRole('spinbutton', { name: 'Days to show', exact: true });
  const original = Number(await days.inputValue());
  await page.getByText('Days to show', { exact: true }).click();
  await expect(days).toHaveValue(String(original));
  await page.getByRole('button', { name: 'Increase days to show', exact: true }).click();
  await expect(days).toHaveValue(String(original + 1));
  await page.getByRole('button', { name: 'Decrease days to show', exact: true }).click();
  await expect(days).toHaveValue(String(original));
  await days.fill('12');
  await days.blur();
  await expect(days).toHaveValue('12');
  await page.getByRole('textbox', { name: 'Custom section name', exact: true }).focus();
  await expect(page.getByRole('textbox', { name: 'Custom section name', exact: true })).toHaveCSS(
    'outline-style',
    'none'
  );
  await expect(
    page.getByRole('textbox', { name: 'Custom section name', exact: true }).locator('..')
  ).toHaveCSS('outline-style', 'solid');
});
