import { expect, type Page } from '@playwright/test';
import { naturalTest as test } from './fixtures';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
import { createKitchenPlan, type KitchenPlan } from '../src/lib/kitchen';
import type { PlanDocument } from '../src/lib/plan-document';

const week = startOfWeek(todayDay());
const saved = (page: Page) =>
  expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
async function snapshot(page: Page): Promise<KitchenPlan> {
  await saved(page);
  return page.evaluate(async () => (await (await fetch('/api/plan')).json()).plan);
}
async function stock(page: Page) {
  await expect(page.locator('.home-tray')).toBeVisible();
  await page.getByTestId('food-ing-paprika').click();
}
async function seed(page: Page, plan: KitchenPlan) {
  let document: PlanDocument = {
    schemaVersion: 2,
    revision: 0,
    updatedAt: new Date().toISOString(),
    plan
  };
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() === 'PUT')
      document = {
        ...document,
        plan: route.request().postDataJSON().plan,
        revision: document.revision + 1
      };
    await route.fulfill({ json: document });
  });
}

test('natural defaults, bounded agenda, readable text, explicit preference and browsing never save', async ({
  page
}, info) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/plan') && request.method() === 'PUT') writes++;
  });
  await page.goto('/');
  await saved(page);
  await expect(
    page.getByRole('button', {
      name: info.project.name === 'phone' ? 'Agenda' : 'Calendar',
      exact: true
    })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'At home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ingredients to use' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Already cooked' })).toBeVisible();
  if (info.project.name === 'desktop') {
    const stockBounds = await page.locator('.home-tray').boundingBox();
    const grid = await page.locator('.calendar-scroll').boundingBox();
    expect(stockBounds!.width).toBe(230);
    expect(stockBounds!.x + stockBounds!.width).toBeLessThan(grid!.x);
    expect(
      await page
        .locator('.time-card-meta')
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
    ).toBeGreaterThanOrEqual(12);
  }
  if (info.project.name === 'phone') {
    const today = await page.locator(`[data-agenda-day="${todayDay()}"]`).boundingBox();
    const area = await page.locator('.agenda-scroll').boundingBox();
    expect(today!.y).toBeGreaterThanOrEqual(area!.y - 1);
    expect(today!.y).toBeLessThan(area!.y + area!.height - 40);
    expect(area!.height).toBeLessThan(844);
  }
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('[data-agenda-day]')).toHaveCount(7);
  await expect(page.getByTestId('agenda-cook-curry')).toContainText('Makes 4 Coconut curry');
  expect(
    await page
      .getByTestId('agenda-cook-curry')
      .locator('strong')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  ).toBeGreaterThanOrEqual(14);
  await page.getByRole('button', { name: 'One fewer day' }).click();
  await expect(page.locator('[data-agenda-day]')).toHaveCount(6);
  await page.getByRole('button', { name: 'One more day' }).click();
  await page.getByRole('button', { name: 'Next days' }).click();
  await page.getByRole('button', { name: 'Previous days' }).click();
  await page.getByLabel('Jump to date').fill('2032-05-12');
  await expect(page.locator('[data-agenda-day]').first()).toHaveAttribute(
    'data-agenda-day',
    '2032-05-12'
  );
  expect(await page.locator('.agenda-scroll').evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Plan on calendar' }).first().click();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(writes).toBe(0);
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeDisabled();
});

test('fresh food has no arbitrary destination; assignment survives every date control and view switch', async ({
  page
}) => {
  await page.goto('/');
  await stock(page);
  await expect(page.getByLabel('Use in activity')).toHaveValue('');
  await page.getByLabel('Amount to assign').fill('0.5');
  await page.getByRole('button', { name: 'Choose on calendar' }).click();
  const before = await snapshot(page);
  for (const name of [
    'Next days',
    'Previous days',
    'Earlier day',
    'One more day',
    'One fewer day',
    'This week'
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.placement-banner')).toContainText('0.5 Paprika');
    await expect(page.locator('.relationship-context')).toContainText('Paprika');
  }
  await page.getByLabel('Jump to date').fill('2030-05-20');
  await expect(page.locator('.placement-banner')).toContainText('0.5 Paprika');
  await page.getByLabel('Jump to date').fill('9999-12-31');
  await expect(page.getByLabel('Jump to date')).toHaveValue('2030-05-20');
  await expect(page.locator('.placement-banner')).toContainText('0.5 Paprika');
  await page.locator('.empty-calendar').first().press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'This week' }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.placement-banner')).toContainText('0.5 Paprika');
  expect(await snapshot(page)).toEqual(before);
  await page.getByTestId('agenda-cook-curry').click();
  await expect(page.locator('.placement-banner')).toHaveCount(0);
  expect((await snapshot(page)).ingredientUses).toContainEqual(
    expect.objectContaining({
      ingredientId: 'ing-paprika',
      activityId: 'cook-curry',
      quantity: 0.5
    })
  );
  await page.getByRole('button', { name: 'Undo last change' }).click();
  expect(await snapshot(page)).toEqual(before);
});

test('meal source survives range and agenda changes until explicit assignment or Escape', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByTestId('agenda-cook-grains').click();
  await page.getByRole('button', { name: 'Plan a meal from this', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Next days' }).click();
  await page.getByLabel('Jump to date').fill(week);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.placement-banner')).toContainText('Grain bowls');
  expect(await snapshot(page)).toEqual(before);
  await page.getByTestId('agenda-bread-mon').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.placement-banner')).toHaveCount(0);
  expect((await snapshot(page)).allocations).toContainEqual(
    expect.objectContaining({ batchId: 'grains', activityId: 'bread-mon', quantity: 2 })
  );
  await page.getByTestId('agenda-cook-grains').click();
  await page.getByRole('button', { name: 'Plan a meal from this', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.placement-banner')).toHaveCount(0);
});

test('inline requirements summarize matching allocations, require explicit source and amount, retain identity and Undo', async ({
  page
}) => {
  const plan = createKitchenPlan(week);
  plan.activityRequirements.push({
    id: 'need',
    activityId: 'cook-curry',
    name: ' paprika ',
    quantity: 3
  });
  plan.batches.push({
    id: 'other-paprika',
    name: 'PAPRIKA',
    quantity: 4,
    unit: 'legacy',
    source: { kind: 'activity', activityId: 'cook-grains' }
  });
  plan.allocations.push({
    id: 'parallel-end',
    batchId: 'other-paprika',
    activityId: 'cook-curry',
    quantity: 1,
    purpose: 'eat',
    when: 'end'
  });
  await seed(page, plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByTestId('agenda-cook-curry').click();
  const inspector = page.getByRole('dialog', { name: 'Activity', exact: true });
  await expect(inspector.locator('.requirement-summary')).toContainText('1 allocated here');
  await inspector.getByRole('button', { name: 'Assign paprika' }).click();
  await expect(inspector.locator('.food-choice')).toHaveCount(2);
  await expect
    .poll(async () => {
      const search = await inspector.getByLabel('Search food to assign').boundingBox();
      const body = await inspector.locator('.inspector-body').boundingBox();
      return search!.y >= body!.y && search!.y + search!.height <= body!.y + body!.height;
    })
    .toBe(true);
  await expect(inspector.getByRole('button', { name: 'Assign here', exact: true })).toHaveCount(0);
  expect(await snapshot(page)).toEqual(plan);
  await inspector.locator('.food-choice').filter({ hasText: 'Raw ingredient' }).click();
  await expect(inspector.getByLabel('Quantity to assign of Paprika')).toHaveValue('2');
  await inspector.getByLabel('Quantity to assign of Paprika').fill('0.5');
  await inspector.getByRole('button', { name: 'Assign here', exact: true }).click();
  await expect(inspector).toBeVisible();
  await expect(inspector.locator('.requirement-summary')).toContainText('1.5 allocated here');
  await expect(inspector.getByRole('status')).toContainText('Assigned 0.5 Paprika here.');
  await expect(page.getByTestId('agenda-cook-curry')).toHaveClass(/selected/);
  const rawAssigned = await snapshot(page);
  expect(rawAssigned.activityRequirements).toEqual(plan.activityRequirements);
  await inspector.getByRole('button', { name: 'Done', exact: true }).click();
  await inspector.getByRole('button', { name: 'Assign paprika' }).click();
  await inspector.locator('.food-choice').filter({ hasText: 'Planned / from' }).click();
  await expect(inspector.getByLabel('Quantity to assign of PAPRIKA')).toHaveValue('1.5');
  await inspector.getByRole('button', { name: 'Assign here', exact: true }).click();
  const assigned = await snapshot(page);
  expect(assigned.allocations.find((item) => item.id === 'parallel-end')).toEqual(
    plan.allocations.find((item) => item.id === 'parallel-end')
  );
  expect(assigned.allocations.filter((item) => item.batchId === 'other-paprika')).toHaveLength(2);
  expect(assigned.activityRequirements).toEqual(plan.activityRequirements);
  await inspector.getByRole('button', { name: 'Done', exact: true }).click();
  await inspector.getByRole('button', { name: 'Assign food', exact: true }).click();
  await inspector.getByLabel('Search food to assign').fill('Coconut curry');
  await expect(inspector.locator('.food-choice')).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  expect(await snapshot(page)).toEqual(rawAssigned);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  expect(await snapshot(page)).toEqual(plan);
});

test('agenda warning navigation reveals off-range blockers and outgoing links keep named destinations read-only', async ({
  page
}) => {
  const plan = createKitchenPlan(week);
  const cook = plan.activities.find((item) => item.id === 'cook-curry')!;
  cook.start = { day: addDays(week, 10), minute: 600 };
  plan.blockers[0].start = { ...cook.start };
  await seed(page, plan);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page
    .locator('.heading-actions')
    .getByRole('button', { name: /^Checks / })
    .click();
  await page
    .getByRole('dialog', { name: 'Things to check' })
    .locator('[data-warning-code="BLOCKED_TIME"]')
    .filter({ hasText: 'Climbing' })
    .getByRole('button', { name: 'Review blocked time', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Blocked time' })).toBeVisible();
  await expect(page.getByLabel('Jump to date')).toHaveValue(addDays(week, 10));
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByTestId('agenda-block-climbing')).toBeFocused();
  await page.getByTestId('agenda-cook-curry').click();
  await expect(page.getByRole('dialog')).toContainText('overlaps blocked time Climbing');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Curry lunch/ })
    .first()
    .click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Curry lunch');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByTestId('agenda-lunch-tue')).toBeFocused();
  expect(await snapshot(page)).toEqual(plan);
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeDisabled();
});

test('view switching still works when browser preference storage is unavailable', async ({
  page
}, info) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Blocked storage');
      }
    })
  );
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/plan') && request.method() === 'PUT') writes++;
  });
  await page.goto('/');
  await saved(page);
  await expect(
    page.getByRole('button', {
      name: info.project.name === 'phone' ? 'Agenda' : 'Calendar',
      exact: true
    })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agenda', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Time-based planner' })).toBeVisible();
  expect(writes).toBe(0);
});

test('only a real activity selection primes stock; deleting it removes the suggestion', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByTestId('agenda-bread-mon').click();
  await expect(page.getByRole('button', { name: 'Assign food', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await stock(page);
  await expect(page.getByLabel('Use in activity')).toHaveValue('bread-mon');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('agenda-bread-mon').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await stock(page);
  await expect(page.getByLabel('Use in activity')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Use here', exact: true })).toBeDisabled();
});

for (const view of ['Agenda', 'Calendar'] as const) {
  test(`${view}: exact off-range midnight producer navigation restores endpoint focus`, async ({
    page
  }) => {
    const plan = createKitchenPlan(week);
    const producer = plan.activities.find((item) => item.id === 'cook-curry')!;
    producer.start = { day: addDays(week, -1), minute: 23 * 60 };
    producer.elapsedMinutes = 60;
    await seed(page, plan);
    await page.goto('/');
    await page.getByRole('button', { name: view, exact: true }).click();
    const lunch = page.getByTestId(`${view === 'Agenda' ? 'agenda' : 'activity'}-lunch-tue`);
    if (view === 'Agenda') await lunch.click();
    else await lunch.getByRole('button', { name: 'Edit Curry lunch' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /From Cook coconut curry \/ ready/ })
      .click();
    await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue(
      'Cook coconut curry'
    );
    const endpoint =
      view === 'Agenda'
        ? page.locator(`[data-agenda-day="${addDays(week, -1)}"] [data-activity-id="cook-curry"]`)
        : page.locator(
            `[data-time-day="${addDays(week, -1)}"] [data-activity-id="cook-curry"] .time-card-main`
          );
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(endpoint).toBeFocused();
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
}

test('agenda shows actual overnight continuation segments and supports keyboard, touch, and no-clickthrough dismissal', async ({
  page
}, info) => {
  const plan = createKitchenPlan(week);
  const activity = plan.activities.find((item) => item.id === 'cook-curry')!;
  activity.start.minute = 23 * 60;
  activity.elapsedMinutes = 120;
  plan.blockers[0].start = { day: week, minute: 23 * 60 + 30 };
  plan.blockers[0].durationMinutes = 90;
  await seed(page, plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const continuation = page
    .locator(`[data-agenda-day="${addDays(week, 1)}"]`)
    .getByTestId('agenda-cook-curry');
  await expect(continuation).toContainText('00:00 - 01:00');
  await expect(continuation).toContainText('Continued from previous day');
  await expect(page.getByTestId(`agenda-${plan.blockers[0].id}`)).toHaveCount(2);
  await continuation.focus();
  await continuation.press('Enter');
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Cook coconut curry');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(continuation).toBeFocused();
  if (info.project.name === 'phone') {
    await continuation.tap();
    // The canonical sheet occupies the calendar, not the stock shelf. An outside
    // stock tap dismisses only; it must not open a second editor underneath it.
    await page.getByTestId('food-ing-paprika').tap();
  } else {
    await continuation.click();
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(await snapshot(page)).toEqual(plan);
});
