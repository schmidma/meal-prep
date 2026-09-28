import { expect, type Page } from '@playwright/test';
import { naturalTest as test } from './fixtures';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
import { createKitchenPlan, type KitchenPlan } from '../src/lib/kitchen';
import type { PlanDocument } from '../src/lib/plan-document';
import { textContrast } from './contrast';

const week = startOfWeek(todayDay());
async function load(page: Page, plan = createKitchenPlan(week)) {
  let document: PlanDocument = {
    schemaVersion: 2,
    revision: 0,
    updatedAt: new Date().toISOString(),
    plan
  };
  const writes: KitchenPlan[] = [];
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() === 'PUT') {
      document = {
        ...document,
        revision: document.revision + 1,
        plan: route.request().postDataJSON().plan
      };
      writes.push(document.plan);
    }
    await route.fulfill({ json: document });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  return {
    writes,
    saved: async () => {
      await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
      return document.plan;
    }
  };
}
const dialog = (page: Page) => page.getByRole('dialog');

// Raw uses are valid parallel records, just like prepared allocations.
test('parallel raw uses survive chooser addition, both inspectors edit/remove by ID, and Undo', async ({
  page
}) => {
  const plan = createKitchenPlan(week);
  plan.ingredientUses = [
    { id: 'raw-first', ingredientId: 'ing-paprika', activityId: 'cook-curry', quantity: 1 },
    { id: 'raw-second', ingredientId: 'ing-paprika', activityId: 'cook-curry', quantity: 2 }
  ];
  const { saved } = await load(page, plan);
  await page.getByTestId('agenda-cook-curry').click();
  await dialog(page).getByRole('button', { name: 'Assign food', exact: true }).click();
  await page.getByLabel('Search food to assign').fill('Paprika');
  await page.locator('.food-choice').click();
  await page.getByLabel('Quantity to assign of Paprika').fill('0.5');
  await page.getByRole('button', { name: 'Assign here', exact: true }).click();
  await expect(page.getByLabel('Search food to assign')).toBeFocused();
  const added = await saved();
  expect(added.ingredientUses).toEqual([
    { ...plan.ingredientUses[0], quantity: 1.5 },
    plan.ingredientUses[1]
  ]);
  expect(added.allocations).toEqual(plan.allocations);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    dialog(page).getByRole('button', { name: 'Assign food', exact: true })
  ).toBeFocused();
  await page.getByLabel('Amount of Paprika used').nth(1).fill('4');
  await page.getByLabel('Amount of Paprika used').nth(1).press('Tab');
  const edited = await saved();
  expect(edited.ingredientUses).toEqual([
    added.ingredientUses[0],
    { ...plan.ingredientUses[1], quantity: 4 }
  ]);
  await page
    .getByRole('button', { name: 'Remove Paprika from activity', exact: true })
    .first()
    .click();
  expect((await saved()).ingredientUses).toEqual([edited.ingredientUses[1]]);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  expect((await saved()).ingredientUses).toEqual(edited.ingredientUses);
  await expect(page.locator('.home-tray')).toBeVisible();
  await page.getByTestId('food-ing-paprika').click();
  await page.getByLabel('Amount assigned to Cook coconut curry').first().fill('0.75');
  await page.getByLabel('Amount assigned to Cook coconut curry').first().press('Tab');
  expect((await saved()).ingredientUses).toEqual([
    { ...edited.ingredientUses[0], quantity: 0.75 },
    edited.ingredientUses[1]
  ]);
  await page
    .getByRole('button', { name: /^Unassign from Cook coconut curry,/ })
    .nth(1)
    .click();
  expect((await saved()).ingredientUses).toEqual([{ ...edited.ingredientUses[0], quantity: 0.75 }]);
  await page.getByRole('button', { name: 'Close details' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Undo last change' }).click();
  expect(await saved()).toEqual(plan);
});

test('requirement chooser recalculates deficit without closing, restores exact opener, and follows edited notes', async ({
  page
}) => {
  const plan = createKitchenPlan(week);
  plan.ingredients.push({ id: 'lemons', name: 'Lemons', quantity: 10, unit: '' });
  plan.activityRequirements.push({
    id: 'lemons-needed',
    activityId: 'cook-curry',
    name: 'Lemons',
    quantity: 3
  });
  const { saved } = await load(page, plan);
  await page.getByTestId('agenda-cook-curry').click();
  const opener = page.getByRole('button', { name: 'Assign Lemons', exact: true });
  await opener.focus();
  await opener.press('Enter');
  await page.locator('.food-choice').click();
  await expect(page.getByLabel('Quantity to assign of Lemons')).toHaveValue('3');
  await page.getByLabel('Quantity to assign of Lemons').fill('1');
  await page.getByRole('button', { name: 'Assign here', exact: true }).press('Enter');
  await expect(page.getByLabel('Search food to assign')).toBeFocused();
  await page.locator('.food-choice').click();
  await expect(page.getByLabel('Quantity to assign of Lemons')).toHaveValue('2');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(opener).toBeFocused();
  expect((await saved()).activityRequirements).toEqual(plan.activityRequirements);
  await page.getByText('Edit ingredient notes', { exact: true }).click();
  await page.getByLabel('Activity ingredient 1 name').fill('Paprika');
  await page.getByLabel('Activity ingredient 1 name').press('Tab');
  await page.getByRole('button', { name: 'Assign Paprika', exact: true }).click();
  await expect(page.getByLabel('Search food to assign')).toHaveValue('Paprika');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Assign Paprika', exact: true })).toBeFocused();
});

for (const source of ['raw', 'meal'] as const) {
  test(`${source} placement survives unrelated blocker deletion in Agenda`, async ({ page }) => {
    await load(page);
    if (source === 'raw') {
      await expect(page.locator('.home-tray')).toBeVisible();
      await page.getByTestId('food-ing-paprika').click();
      await page.getByLabel('Amount to assign').fill('5');
      await page.getByRole('button', { name: 'Choose on calendar' }).click();
    } else {
      await page.getByTestId('agenda-cook-grains').click();
      await page.getByRole('button', { name: 'Plan a meal from this', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await page.getByTestId('agenda-block-climbing').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.placement-banner')).toContainText(
      source === 'raw' ? '5 Paprika' : 'Grain bowls'
    );
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(page.locator('.placement-banner')).toHaveCount(0);
  });
}

test('Agenda QuickCreate uses chosen date/time/duration/yield, preserves edited duration across recipe choice', async ({
  page
}, info) => {
  const plan = createKitchenPlan(week);
  plan.recipes = [
    {
      id: 'recipe',
      name: 'Lemon cake',
      yieldQuantity: 8,
      durationMinutes: 80,
      ingredients: [{ id: 'line', name: 'Lemons', quantity: 2 }],
      instructions: 'Bake.'
    }
  ];
  const { writes, saved } = await load(page, plan);
  const add = page
    .locator(`[data-agenda-day="${week}"]`)
    .getByRole('button', { name: 'Add activity', exact: true });
  await add.focus();
  await add.press('Enter');
  await expect(page.getByLabel('Activity date')).toHaveValue(week);
  await expect(page.getByLabel('Activity time')).toHaveValue('12:00');
  await page.getByLabel('Activity date').fill(addDays(week, 10));
  await page.getByLabel('Activity time').fill('14:25');
  await page.getByLabel('Duration minutes').fill('95');
  await page.getByRole('combobox', { name: 'Activity name' }).fill('Lemon');
  if (info.project.name === 'phone') await page.getByRole('option', { name: 'Lemon cake' }).tap();
  else {
    await page.getByRole('combobox', { name: 'Activity name' }).press('ArrowDown');
    await page.getByRole('combobox', { name: 'Activity name' }).press('Enter');
  }
  await expect(page.getByLabel('Duration minutes')).toHaveValue('95');
  await page.getByLabel('Make quantity').fill('12');
  await expect(page.getByLabel('Jump to date')).toHaveValue(week);
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Add to plan' }).click();
  const created = (await saved()).activities.find((item) => item.title === 'Lemon cake')!;
  expect(created.start).toEqual({ day: addDays(week, 10), minute: 865 });
  expect(created.elapsedMinutes).toBe(95);
  expect(
    (await saved()).batches.find(
      (item) => item.source.kind === 'activity' && item.source.activityId === created.id
    )?.quantity
  ).toBe(12);
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByTestId(`agenda-${created.id}`)).toBeInViewport();
  await expect(page.getByLabel('Jump to date')).toHaveValue(addDays(week, 10));
});

test('Agenda creates Eat, Anything and Block; invalid/cancelled drafts never write or click through', async ({
  page
}) => {
  const { writes, saved } = await load(page);
  for (const kind of ['Eat', 'Anything', 'Block']) {
    await page.getByRole('button', { name: 'Add activity', exact: true }).first().click();
    await page.getByLabel('Activity name', { exact: true }).fill(`New ${kind}`);
    await page.getByRole('button', { name: kind, exact: true }).click();
    await page.getByLabel('Activity time').fill('09:15');
    await page.getByLabel('Duration minutes').fill('35');
    await page.getByRole('button', { name: 'Add to plan' }).click();
    const plan = await saved();
    const item = [...plan.activities, ...plan.blockers].find(
      (item) => item.title === `New ${kind}`
    )!;
    expect(item.start).toEqual({ day: week, minute: 555 });
    expect('elapsedMinutes' in item ? item.elapsedMinutes : item.durationMinutes).toBe(35);
    await expect(page.getByTestId(`agenda-${item.id}`)).toBeInViewport();
  }
  const count = writes.length;
  await page.getByRole('button', { name: 'Add activity', exact: true }).first().click();
  await page.getByLabel('Activity name', { exact: true }).fill('Invalid end');
  await page.getByLabel('Activity date').fill('9999-12-31');
  await page.getByLabel('Activity time').fill('23:55');
  await page.getByRole('button', { name: 'Add to plan' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('alert')).toContainText('years 1-9999');
  await page.getByLabel('Activity time').fill('');
  await page.getByRole('button', { name: 'Add to plan' }).click();
  expect(writes).toHaveLength(count);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add activity', exact: true }).first().click();
  await page.getByLabel('Activity name', { exact: true }).fill('Cancel me');
  await page.mouse.click(4, 80);
  await expect(dialog(page)).toHaveCount(0);
  expect(writes).toHaveLength(count);
});

test('outputs and meal actions precede long notes; over-assigned stock uses readable warning status in both themes', async ({
  page
}) => {
  const plan = createKitchenPlan(week);
  plan.activityRequirements = Array.from({ length: 12 }, (_, index) => ({
    id: `need-${index}`,
    activityId: 'bake-cake',
    name: `Ingredient ${index + 1}`,
    quantity: 1
  }));
  plan.ingredients[0].quantity = 1;
  plan.ingredientUses.push({
    id: 'over-stock',
    ingredientId: 'ing-paprika',
    activityId: 'bake-cake',
    quantity: 2
  });
  const prepared = plan.batches.find((item) => item.source.kind === 'existing')!;
  prepared.quantity = 0.25;
  const { writes } = await load(page, plan);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.getByTestId('agenda-bake-cake').click();
    await expect(page.getByLabel('Amount made of Cake')).toHaveValue('8');
    const body = await page.locator('.inspector-body').boundingBox();
    for (const control of [
      page.getByRole('button', { name: 'Plan a meal from this', exact: true }),
      page.getByRole('button', { name: /^Cake with friends/ })
    ]) {
      const bounds = await control.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(body!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(body!.y + body!.height);
    }
    await expect(page.getByLabel('Activity ingredient 1 name')).not.toBeVisible();
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(page.locator('.home-tray')).toBeVisible();
    for (const id of ['ing-paprika', prepared.id]) {
      const chip = page.getByTestId(`food-${id}`);
      await expect(chip).toHaveClass(/over-assigned/);
      await expect(chip.locator('small')).toContainText('over-assigned');
      expect(await textContrast(chip.locator('small'))).toBeGreaterThanOrEqual(4.5);
      expect(await textContrast(chip.locator(':scope > svg'), false)).toBeGreaterThanOrEqual(3);
    }
    await expect(page.getByTestId('food-ing-spinach')).not.toHaveClass(/over-assigned/);
  }
  expect(writes).toHaveLength(0);
});

test('off-range references are bounded independent of collision lanes and exact overnight identity stays visible', async ({
  page
}) => {
  const plan = createKitchenPlan(week);
  const cook = plan.activities.find((item) => item.id === 'cook-curry')!;
  cook.start = { day: week, minute: 1290 };
  cook.elapsedMinutes = 780;
  const lunch = plan.activities.find((item) => item.id === 'lunch-tue')!;
  lunch.start = { day: addDays(week, 8), minute: 450 };
  plan.activities = [
    cook,
    lunch,
    {
      ...lunch,
      id: 'collision',
      title: 'Readiness check',
      start: { day: addDays(week, 1), minute: 600 },
      elapsedMinutes: 15
    }
  ];
  plan.batches = plan.batches.filter((item) => item.id === 'curry');
  plan.allocations = plan.allocations.filter(
    (item) => item.batchId === 'curry' && item.activityId === 'lunch-tue'
  );
  plan.ingredientUses = [];
  plan.activityRequirements = [];
  const { writes } = await load(page, plan);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Jump to date').fill(addDays(week, 8));
  await page.getByRole('button', { name: 'Edit Curry lunch', exact: true }).click();
  await dialog(page)
    .getByRole('button', { name: /^From Cook coconut curry/ })
    .click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Cook coconut curry');
  await page.getByRole('button', { name: 'Close details' }).click();
  const copy = page.locator(
    `[data-time-day="${addDays(week, 1)}"] [data-activity-id="cook-curry"] .time-card-copy`
  );
  await expect(copy.locator('strong')).toBeInViewport({ ratio: 1 });
  await expect(copy).toContainText('10:30');
  const endpoint = await page
    .locator(`[data-time-day="${addDays(week, 1)}"] [data-activity-id="cook-curry"] .resize-end`)
    .boundingBox();
  const area = await page.locator('.calendar-scroll').boundingBox();
  expect(endpoint!.y + 12).toBeGreaterThan(area!.y + 54);
  expect(endpoint!.y + 12).toBeLessThan(area!.y + area!.height);
  await page.keyboard.press('Tab');
  await page
    .getByRole('button', { name: 'Edit Cook coconut curry', exact: true })
    .last()
    .evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
  const strip = page.getByRole('region', { name: 'Food relationships outside this range' });
  const link = strip.getByRole('button').first();
  await expect(link).toContainText('07:30');
  const bounds = await link.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(200);
  expect(bounds!.height).toBeLessThan(148);
  expect(
    await link.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest('button') === element
      );
    })
  ).toBe(true);
  expect(await strip.getByRole('button').count()).toBe(1);
  await link.click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Curry lunch');
  expect(writes).toHaveLength(0);
});
