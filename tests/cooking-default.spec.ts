import { test, expect, openPreparation } from './weekly-fixtures';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
const week = startOfWeek(todayDay());
const label = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

test('new cooks default to today and can be planned for a selected day', async ({ page }, info) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Cooking day: ${label(todayDay())}`, exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill('curry');
  await page.getByRole('option', { name: /Chickpea & spinach curry/ }).click();
  await page.getByRole('button', { name: `Cooking day: ${label(week)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
  await page.getByRole('button', { name: /Chickpea & spinach curry.*portions available/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
});
