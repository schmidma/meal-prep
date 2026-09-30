import { test, expect } from './weekly-fixtures';

test('long press moves a meal without opening its dialog and a tap still edits', async ({
  page,
  context
}, info) => {
  test.skip(info.project.name !== 'phone', 'Touch gesture review');
  await page.goto('/');
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Something else/ }).click();
  await page.getByLabel('Meal name', { exact: true }).fill('Lunch out');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const source = page.getByRole('button', { name: 'Edit Lunch out', exact: true });
  const destination = page
    .locator('.wp-day')
    .nth(2)
    .getByRole('group', { name: 'Dinner', exact: true });
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await destination.boundingBox())!;
  const client = await context.newCDPSession(page);
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await expect(page.locator('.wp-touch-ghost')).toBeVisible();
  for (let i = 1; i <= 12; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: start.x + ((end.x - start.x) * i) / 12, y: start.y + ((end.y - start.y) * i) / 12 }
      ]
    });
  }
  await page.screenshot({ path: '/tmp/touch-planning-active.png' });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(
    destination.getByRole('button', { name: 'Edit Lunch out', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.wp-touch-ghost')).toHaveCount(0);
  // A subsequent tap is a normal edit, not a drag.
  await page.getByRole('button', { name: 'Add lunch on Friday', exact: true }).tap();
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await source.tap();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('keyboard moves use the same cooking-date guard without extra card controls', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Cook something/ }).click();
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill('Soup');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const meal = page.getByRole('button', { name: 'Edit Soup', exact: true });
  await meal.focus();
  await meal.press('Alt+ArrowLeft');
  await expect(
    page.locator('.wp-day').nth(1).getByRole('button', { name: 'Edit Soup', exact: true })
  ).toBeVisible();
  await meal.press('Alt+ArrowDown');
  await meal.press('Alt+ArrowRight');
  await expect(
    page
      .locator('.wp-day')
      .nth(2)
      .getByRole('group', { name: 'Dinner', exact: true })
      .getByRole('button', { name: 'Edit Soup', exact: true })
  ).toBeFocused();
  const cook = page.getByRole('button', { name: 'Cooking on Tuesday: Soup', exact: true });
  await cook.focus();
  await cook.press('Alt+ArrowRight');
  const movedCook = page.getByRole('button', { name: 'Cooking on Wednesday: Soup', exact: true });
  await expect(movedCook).toBeFocused();
  await movedCook.press('Alt+ArrowRight');
  await expect(movedCook).toBeVisible();
  await expect(page.getByRole('button', { name: /^Move meal|^Move cooking/ })).toHaveCount(0);
});
