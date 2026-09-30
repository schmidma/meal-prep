import { signIn, householdAction } from './auth-helpers';
import { randomUUID } from 'node:crypto';
import { test, expect, openPreparation } from './weekly-fixtures';
import { test as base } from '@playwright/test';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
const week = startOfWeek(todayDay());
const label = (offset: number) =>
  new Date(addDays(week, offset) + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

test('meal edits stay focused and removal can be undone', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await expect(page.getByText(/playground/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a meal', exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: /Something else/ }).click();
  await page.getByLabel('Meal name', { exact: true }).fill('Lunch out');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Lunch out', exact: true }).click();
  await expect(page.getByLabel('Meal', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Day:/ })).toHaveCount(0);
  await page.getByLabel('Meal name', { exact: true }).fill('Lunch out updated');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page
      .locator('.wp-day')
      .nth(1)
      .getByRole('group', { name: 'Lunch', exact: true })
      .getByRole('button', { name: 'Edit Lunch out updated' })
  ).toBeVisible();
  await page.reload();
  await openPreparation(page);
  await page.getByRole('button', { name: 'Remove meal Lunch out updated', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Lunch out updated' })).toBeVisible();
});

test('both dialog types close on their backdrop and protect unsaved changes', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: 'Add lunch on Monday', exact: true }).click();
  await page.mouse.click(3, 3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await page.mouse.click(3, 3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await page.getByRole('combobox', { name: 'Meal name', exact: true }).fill('Something new');
  await page.mouse.click(3, 3);
  await page
    .getByRole('dialog', { name: 'Discard changes?' })
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('shopping checking and editing keep every row in place and target the right item', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: /^Shopping/ }).click();
  for (const name of ['Tomatoes', 'Milk', 'Bread']) {
    await page.getByLabel('Shopping item', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add shopping item' }).click();
  }
  const row = page
    .locator('.wp-shopping-row')
    .filter({ has: page.getByRole('checkbox', { name: 'Tomatoes', exact: true }) });
  const before = await row.boundingBox();
  await page.getByRole('checkbox', { name: 'Tomatoes', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Milk', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Bread', exact: true })).not.toBeChecked();
  expect((await row.boundingBox())!.y).toBe(before!.y);
  await page.getByRole('button', { name: 'Edit shopping Tomatoes', exact: true }).click();
  expect((await row.boundingBox())!.height).toBe(before!.height);
  await page.getByLabel('Edit shopping item').fill('Cherry tomatoes');
  await page.getByRole('button', { name: 'Save shopping edit' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Cherry tomatoes', exact: true })
  ).not.toBeChecked();
  await page.reload();
  await openPreparation(page);
  await page.getByRole('button', { name: /^Shopping/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk', exact: true })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Cherry tomatoes', exact: true })
  ).not.toBeChecked();
});

test('use soon persists and suggests recipes by ingredient, including aliases', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByLabel('Ingredient to use soon').fill('Capsicum');
  await page.getByRole('button', { name: 'Add use-soon ingredient' }).click();
  await page.reload();
  await openPreparation(page);
  await expect(page.getByRole('heading', { name: 'Shopping list', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find recipes', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await page.getByRole('combobox', { name: 'Meal name' }).click();
  const suggestions = page.getByRole('dialog').getByRole('option');
  await expect(suggestions.first()).toContainText('Roasted vegetable bowls');
  await expect(suggestions.first()).toContainText('Uses bell pepper');
  await suggestions.first().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit cooking Roasted vegetable bowls', exact: true })
  ).toBeVisible();
});

test('leftovers can start from a recipe and be planned without a cooking event', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.locator('#leftovers').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('combobox', { name: 'Leftover name' }).fill('tomato');
  await page.getByRole('option', { name: /Roasted tomato soup/ }).click();
  await page.getByLabel('Portions', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
  await page.getByRole('button', { name: /Roasted tomato soup 2 portions ready/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.wp-meal img')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Edit Roasted tomato soup', exact: true })
  ).toContainText('2 portions');
  await expect(
    page.getByRole('button', { name: 'Edit leftovers Roasted tomato soup', exact: true })
  ).toContainText('All planned');
  await page.getByRole('button', { name: 'Remove meal Roasted tomato soup', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit leftovers Roasted tomato soup', exact: true })
  ).toContainText('2 portions');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.reload();
  await openPreparation(page);
  await expect(
    page.getByRole('button', { name: 'Edit leftovers Roasted tomato soup', exact: true })
  ).toContainText('All planned');

  await expect(page.getByRole('button', { name: /Edit cooking/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove leftovers Roasted tomato soup' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit Roasted tomato soup', exact: true })
  ).toBeVisible();
});

test('actual drag moves leftovers into a slot and meals from lunch to dinner', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'Touch uses meal slots and the Eat leftovers picker.');
  await page.goto('/');
  await openPreparation(page);
  await page.locator('#leftovers').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('combobox', { name: 'Leftover name' }).fill('Soup leftovers');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const lunch = page.locator('.wp-day').nth(1).getByRole('group', { name: 'Lunch', exact: true });
  const dinner = page.locator('.wp-day').nth(1).getByRole('group', { name: 'Dinner', exact: true });
  async function drag(
    source: ReturnType<typeof page.locator>,
    target: ReturnType<typeof page.locator>,
    blocked = false
  ) {
    await source.scrollIntoViewIfNeeded();
    const box = (await source.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 22, { steps: 6 });
    await target.scrollIntoViewIfNeeded();
    const dest = (await target.boundingBox())!;
    await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 20 });
    if (blocked) await expect(target).toHaveAttribute('aria-disabled', 'true');
    await page.mouse.up();
  }
  await drag(
    page.getByRole('button', { name: 'Edit leftovers Soup leftovers', exact: true }),
    lunch
  );
  await expect(
    lunch.getByRole('button', { name: 'Edit Soup leftovers', exact: true })
  ).toBeVisible();
  await drag(lunch.getByRole('button', { name: 'Edit Soup leftovers', exact: true }), dinner);
  await expect(
    dinner.getByRole('button', { name: 'Edit Soup leftovers', exact: true })
  ).toBeVisible();
  await expect(lunch.getByRole('button', { name: 'Edit Soup leftovers', exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: 'Edit leftovers Soup leftovers', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Plan a cook', exact: true }).click();
  await page.getByRole('combobox', { name: 'Meal name' }).fill('Curry batch');
  await page.getByRole('button', { name: `Cooking day: ${label(0)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const cook = page.getByRole('button', { name: 'Edit cooking Curry batch', exact: true });
  await drag(cook, lunch);
  await expect(lunch.getByRole('button', { name: 'Edit Curry batch', exact: true })).toBeVisible();
  await expect(cook.locator('[aria-label="2 portions available"]')).toBeVisible();
  await drag(cook, dinner);
  await expect(cook.locator('[aria-label="0 portions available"]')).toBeVisible();
  const friday = page.locator('.wp-day').nth(4).getByRole('group', { name: 'Lunch', exact: true });
  await expect(cook).toHaveAttribute('draggable', 'false');
  await expect(friday.getByRole('button', { name: 'Edit Curry batch', exact: true })).toHaveCount(
    0
  );
  await page.reload();
  await openPreparation(page);
  await expect(page.locator('.wp-meal').filter({ hasText: 'Curry batch' })).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Cooking on Monday: Curry batch', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cooking on Monday: Curry batch', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit cooking plan' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await drag(
    page.getByRole('button', { name: 'Cooking on Monday: Curry batch', exact: true }),
    friday,
    true
  );
  await expect(
    page.getByRole('button', { name: 'Cooking on Friday: Curry batch', exact: true })
  ).toHaveCount(0);
  await expect(lunch.getByRole('button', { name: 'Edit Curry batch', exact: true })).toBeVisible();

  await expect(
    page.getByRole('button', { name: 'Cooking on Monday: Curry batch', exact: true })
  ).toBeVisible();
});

base(
  'new household starts empty and old query links cannot select another plan',
  async ({ request }) => {
    await signIn(request, `seed-${randomUUID()}@example.test`);
    await householdAction(request, { action: 'create', name: 'Seed test' });
    const root = await (await request.get('/api/plan')).json();
    const oldLink = await (await request.get('/api/plan?playground=1')).json();
    expect(root.plan).toEqual(oldLink.plan);
    expect(root.plan.recipes).toHaveLength(0);
    expect(root.plan.activities).toHaveLength(0);
  }
);

test('agenda ranges change the view without changing the plan', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await expect(page.locator('.wp-day')).toHaveCount(7);
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Something else/ }).click();
  await page.getByLabel('Meal name', { exact: true }).fill('Picnic');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).fill('14');
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).blur();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.wp-day')).toHaveCount(14);
  await expect(page.getByRole('button', { name: 'Edit Picnic', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Days to show', exact: true }).blur();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.wp-day')).toHaveCount(3);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.wp-day').first()).toHaveAttribute('id', `day-${addDays(week, 1)}`);
  await page.reload();
  await openPreparation(page);
  await expect(page.locator('.wp-day')).toHaveCount(3);
  await expect(page.locator('.wp-day').first()).toHaveAttribute('id', `day-${addDays(week, 1)}`);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('button', { name: 'Edit Picnic', exact: true })).toBeVisible();
});

test('meal portions use the configured default independently of individual edits', async ({
  page
}) => {
  await page.goto('/');
  await openPreparation(page);
  await page.locator('#leftovers').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('combobox', { name: 'Leftover name' }).fill('Soup');
  await page.getByLabel('Portions', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  for (const day of ['Monday', 'Tuesday']) {
    await page.getByRole('button', { name: `Add lunch on ${day}`, exact: true }).click();
    await page.getByRole('button', { name: /Use a planned cook or leftovers/ }).click();
    await page.getByRole('button', { name: /Soup .*portions ready/ }).click();
    if (day === 'Monday')
      await page.getByRole('spinbutton', { name: 'Portions for this meal', exact: true }).fill('1');
    else
      await expect(
        page.getByRole('spinbutton', { name: 'Portions for this meal', exact: true })
      ).toHaveValue('2');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    if (day === 'Monday') {
      await page.reload();
      await openPreparation(page);
    }
  }
  await expect(
    page.getByRole('button', { name: 'Edit leftovers Soup', exact: true })
  ).toContainText('2 portions');
});

test('switching sections starts at the top of the page', async ({ page }) => {
  await page.goto('/');
  await openPreparation(page);
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', { name: /^Shopping/ }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await expect(page.getByRole('combobox', { name: 'Search recipes' })).toBeInViewport();
});

test('meal delete control does not linger after pointer editing but remains keyboard accessible', async ({
  page
}, info) => {
  test.skip(info.project.name === 'phone', 'Touch devices keep the delete control visible.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Add lunch on Tuesday', exact: true }).click();
  await page.getByRole('button', { name: /Something else/ }).click();
  await page.getByLabel('Meal name', { exact: true }).fill('Focus check');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const card = page.getByRole('button', { name: 'Edit Focus check', exact: true });
  const remove = page.getByRole('button', { name: 'Remove meal Focus check', exact: true });
  await card.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(card).toBeFocused();
  await expect(remove).toHaveCSS('opacity', '0');
  await card.hover();
  await expect(remove).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await expect(remove).toHaveCSS('opacity', '1');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await expect(remove).toHaveCSS('opacity', '1');
});
