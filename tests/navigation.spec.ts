import { expect } from '@playwright/test';
import { test } from './fixtures';

test('fewer days hides the last day without deleting plan content, and more days restores it', async ({
  page
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/plan') && request.method() === 'PUT') writes++;
  });
  await page.goto('/');
  const days = page.locator('[data-time-day]');
  const fewer = page.getByRole('button', { name: 'One fewer day' });
  const more = page.getByRole('button', { name: 'One more day' });
  await expect(days).toHaveCount(7);
  const sunday = await days.nth(6).getAttribute('data-time-day');
  const saturday = await days.nth(5).getAttribute('data-time-day');
  await expect(page.getByTestId('activity-travel-sun')).toBeVisible();
  await expect(page.getByTestId('activity-cake-friends')).toBeVisible();
  await expect(page.getByTestId('activity-cake-friends')).toContainText('6');
  await expect(fewer).toHaveAttribute('title', /Hide the last visible day without removing/);

  await fewer.click();
  await expect(days).toHaveCount(6);
  await expect(page.getByTestId('activity-travel-sun')).toHaveCount(0);
  await fewer.click();
  await expect(days).toHaveCount(5);
  await expect(page.getByTestId('activity-cake-friends')).toHaveCount(0);
  await more.click();
  await expect(days).toHaveCount(6);
  await expect(days.nth(5)).toHaveAttribute('data-time-day', saturday!);
  await expect(page.getByTestId('activity-cake-friends')).toBeVisible();
  await expect(page.getByTestId('activity-cake-friends')).toContainText('6');
  await more.click();
  await expect(days).toHaveCount(7);
  await expect(days.nth(6)).toHaveAttribute('data-time-day', sunday!);
  await expect(page.getByTestId('activity-travel-sun')).toBeVisible();
  expect(writes).toBe(0);
});

test('a single day is the minimum; This week restores seven visible days', async ({ page }) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/plan') && request.method() === 'PUT') writes++;
  });
  await page.goto('/');
  const days = page.locator('[data-time-day]');
  const fewer = page.getByRole('button', { name: 'One fewer day' });
  const firstDay = await days.first().getAttribute('data-time-day');
  for (let count = 6; count >= 1; count--) {
    await fewer.click();
    await expect(days).toHaveCount(count);
  }
  await expect(fewer).toBeDisabled();
  await expect(days.first()).toHaveAttribute('data-time-day', firstDay!);
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(days).toHaveCount(7);
  await expect(days.first()).toHaveAttribute('data-time-day', firstDay!);
  await expect(page.getByTestId('activity-travel-sun')).toBeVisible();
  expect(writes).toBe(0);
});
