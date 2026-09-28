import { expect } from '@playwright/test';
import { test } from './fixtures';
import { todayDay } from '../src/lib/calendar';

async function openStock(page: import('@playwright/test').Page) {
  const tray = page.locator('.home-tray');
  await expect(tray).toBeVisible();
  return tray;
}

test('details reserve a rail or bounded sheet, retain editable identity while scrolling, and restore focus without scrolling', async ({
  page
}, info) => {
  await page.goto('/');
  const invoker = page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' });
  await invoker.click();
  const panel = page.getByRole('dialog', { name: 'Activity', exact: true });
  const title = panel.getByLabel('Activity name', { exact: true });
  const initial = await title.boundingBox();
  const bounds = await panel.boundingBox();
  const calendar = await page.locator('.calendar-shell').boundingBox();
  expect(bounds).not.toBeNull();
  if (info.project.name === 'desktop')
    expect(calendar!.x + calendar!.width).toBeLessThanOrEqual(bounds!.x);
  else {
    expect(bounds!.height).toBeLessThanOrEqual(844 * 0.72 + 1);
    await expect(title).not.toBeFocused();
  }
  await panel.locator('.inspector-body').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await title.boundingBox()).toEqual(initial);
  await expect(panel.getByRole('button', { name: 'Close details' })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const before = await page.evaluate(() => [
    window.scrollY,
    document.querySelector('.calendar-scroll')!.scrollTop,
    document.querySelector('.calendar-scroll')!.scrollLeft
  ]);
  await panel.getByRole('button', { name: 'Close details' }).click();
  await expect(invoker).toBeFocused();
  expect(
    await page.evaluate(() => [
      window.scrollY,
      document.querySelector('.calendar-scroll')!.scrollTop,
      document.querySelector('.calendar-scroll')!.scrollLeft
    ])
  ).toEqual(before);
  await expect(page.locator('.food-connection')).toHaveCount(0);
});

test('stock stays bounded, today is revealed only on initial load or This week, and calendar assignment is explicit', async ({
  page
}, info) => {
  await page.goto('/');
  await expect(page.locator('[data-time-day]')).toHaveCount(7);
  if (info.project.name === 'phone') {
    const today = page.locator(`[data-time-day="${todayDay()}"]`);
    const day = await today.boundingBox(),
      scroll = await page.locator('.calendar-scroll').boundingBox();
    expect(day!.x).toBeGreaterThanOrEqual(scroll!.x + 50);
    // At the last day, native scrollLeft clamps before the day can reach the left rail.
    await expect
      .poll(async () => {
        const bounds = (await today.boundingBox())!;
        return bounds.x + bounds.width;
      })
      .toBeLessThanOrEqual(scroll!.x + scroll!.width);
  }
  const tray = await openStock(page);
  if (info.project.name === 'phone') {
    const bounds = await tray.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(844 * 0.38 + 1);
    const calendar = await page.locator('.calendar-scroll').boundingBox();
    expect(calendar!.y).toBeGreaterThan(bounds!.y + bounds!.height);
    expect(
      await tray
        .locator('.stock-row')
        .first()
        .evaluate((element) => element.scrollWidth > element.clientWidth)
    ).toBe(true);
  }
  const stockBounds = await tray.boundingBox();
  await page.getByTestId('food-ing-paprika').click();
  expect(await tray.boundingBox()).toEqual(stockBounds);
  const details = page.getByRole('dialog', { name: 'Ingredient', exact: true });
  await details.getByLabel('Amount to assign').fill('0.5');
  const baseline = await page.evaluate(async () => (await (await fetch('/api/plan')).json()).plan);
  await details.getByRole('button', { name: 'Choose on calendar' }).click();
  await expect(details).toHaveCount(0);
  await expect(page.locator('.placement-banner')).toContainText('0.5 Paprika');
  await page.locator('.calendar-scroll').evaluate((element) => {
    element.scrollTop = 9 * 75;
    element.scrollLeft = 0;
  });
  const day = await page.locator('[data-time-day]').first().boundingBox();
  await page.mouse.click(day!.x + day!.width / 2, day!.y + 600 * 1.25);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(async () => (await (await fetch('/api/plan')).json()).plan)).toEqual(
    baseline
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.placement-banner')).toHaveCount(0);
  await openStock(page);
  await page.getByTestId('food-ing-paprika').click();
  await details.getByLabel('Amount to assign').fill('0.5');
  await details.getByRole('button', { name: 'Choose on calendar' }).click();
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.placement-banner')).toHaveCount(0);
  await expect(page.locator('.notice')).toContainText('Assigned 0.5 Paprika to Cook coconut curry');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const changed = await page.evaluate(async () => (await (await fetch('/api/plan')).json()).plan);
  expect(
    changed.ingredientUses.find(
      (use: { ingredientId: string; activityId: string }) =>
        use.ingredientId === 'ing-paprika' && use.activityId === 'cook-curry'
    ).quantity
  ).toBe(0.5);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  expect(await page.evaluate(async () => (await (await fetch('/api/plan')).json()).plan)).toEqual(
    baseline
  );
  if (info.project.name === 'phone') {
    await page.getByRole('button', { name: 'This week', exact: true }).click();
    const today = await page.locator(`[data-time-day="${todayDay()}"]`).boundingBox();
    const scroll = await page.locator('.calendar-scroll').boundingBox();
    expect(today!.x).toBeGreaterThanOrEqual(scroll!.x + 50);
    await expect
      .poll(async () => {
        const bounds = (await page.locator(`[data-time-day="${todayDay()}"]`).boundingBox())!;
        return bounds.x + bounds.width;
      })
      .toBeLessThanOrEqual(scroll!.x + scroll!.width);
  }
});

test('phone stock grip retains capture and stays visible through cancellation and successful drop', async ({
  page
}, info) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  test.skip(info.project.name !== 'phone', 'Native touch shelf interaction.');
  await page.locator('.calendar-scroll').evaluate((element) => {
    element.scrollTop = 18 * 75;
    element.scrollLeft = 0;
  });
  const tray = await openStock(page);
  const grip = page.getByTestId('food-ing-paprika').locator('.drag-grip');
  const rect = await grip.boundingBox();
  const from = { x: rect!.x + rect!.width / 2, y: rect!.y + rect!.height / 2 };
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: from.x, y: from.y - 50 }]
  });
  const stockBounds = await tray.boundingBox();
  await expect(tray).toBeVisible();
  expect(await grip.evaluate((element) => element.isConnected)).toBe(true);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await tray.boundingBox()).toEqual(stockBounds);
  await expect(tray).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeDisabled();
  const target = await page.getByTestId('activity-cook-curry').boundingBox();
  const to = { x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 12; step++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + ((to.x - from.x) * step) / 12, y: from.y + ((to.y - from.y) * step) / 12 }
      ]
    });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await tray.boundingBox()).toEqual(stockBounds);
  await expect(tray).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeEnabled();
  await expect(page.locator('.notice')).toContainText('Assigned 2 Paprika to Cook coconut curry');
  await session.detach();
});
