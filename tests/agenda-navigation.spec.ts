import { test, expect } from './weekly-fixtures';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';

test('navigation nudges one day and Today restores the Monday anchor for week views', async ({
  page
}) => {
  await page.goto('/');
  const start = page.locator('.wp-day').first();
  const monday = startOfWeek(todayDay());
  await expect(start).toHaveAttribute('id', `day-${monday}`);
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(start).toHaveAttribute('id', `day-${addDays(monday, 1)}`);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(start).toHaveAttribute('id', `day-${monday}`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).fill('14');
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).blur();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(start).toHaveAttribute('id', `day-${addDays(monday, -1)}`);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(start).toHaveAttribute('id', `day-${monday}`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).blur();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(start).toHaveAttribute('id', `day-${monday}`);
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(start).toHaveAttribute('id', `day-${addDays(monday, -1)}`);
  await page.reload();
  await expect(start).toHaveAttribute('id', `day-${addDays(monday, -1)}`);
});
