import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
import type { Activity, Allocation, Batch } from '../src/lib/domain';
import { validateKitchenPlan, type KitchenPlan } from '../src/lib/kitchen';
import { parseKitchenPlan, type PlanDocument } from '../src/lib/plan-document';

const day = startOfWeek(todayDay());
const activity = (
  id: string,
  title: string,
  offset: number,
  minute = 780,
  elapsedMinutes = 60,
  kind: Activity['kind'] = 'cook'
): Activity => ({
  id,
  title,
  start: { day: addDays(day, offset), minute },
  elapsedMinutes,
  kind,
  handsOnMinutes: 7,
  requiresHome: true,
  notes: 'Keep legacy metadata'
});
const batch = (id: string, name: string, producer: string): Batch => ({
  id,
  name,
  quantity: 20,
  unit: 'portions',
  source: { kind: 'activity', activityId: producer }
});
const allocation = (
  id: string,
  batchId: string,
  activityId: string,
  purpose: Allocation['purpose'] = 'eat',
  when: Allocation['when'] = 'start'
): Allocation => ({ id, batchId, activityId, quantity: 0.5, purpose, when });
function fixture(): KitchenPlan {
  return {
    activities: [
      activity('cook', 'Make pepper dinner', 0),
      activity('meal', 'Pepper lunch', 1, 780, 60, 'meal'),
      activity('sibling', 'Sibling dinner', 2, 780, 60, 'meal'),
      activity('other', 'Another raw user', 0, 900),
      activity('side', 'Make side salad', 0, 660),
      activity('source', 'Overnight stock source', -8, 1410, 90),
      activity('far', 'Far future dinner', 12, 840, 60, 'meal'),
      activity('early', 'Too early dinner', 0, 720, 30, 'meal')
    ],
    batches: [
      batch('main', 'Pepper stew', 'cook'),
      batch('sauce', 'Pepper sauce', 'cook'),
      batch('stock', 'Prepared stock', 'source'),
      batch('salad', 'Side salad', 'side')
    ],
    allocations: [
      allocation('input', 'stock', 'cook', 'ingredient'),
      allocation('lunch-start', 'main', 'meal'),
      allocation('lunch-end', 'main', 'meal', 'eat', 'end'),
      allocation('lunch-ingredient', 'main', 'meal', 'ingredient'),
      allocation('to-sibling', 'main', 'sibling'),
      allocation('side-meal', 'salad', 'meal'),
      allocation('far-meal', 'sauce', 'far'),
      allocation('self', 'main', 'cook', 'eat', 'end'),
      allocation('too-early', 'main', 'early', 'eat', 'end')
    ],
    ingredients: [{ id: 'raw', name: 'Raw peppers', quantity: 8, unit: 'pieces' }],
    ingredientUses: [
      { id: 'raw-cook', ingredientId: 'raw', activityId: 'cook', quantity: 1 },
      { id: 'raw-other', ingredientId: 'raw', activityId: 'other', quantity: 1 }
    ],
    blockers: [
      {
        id: 'blocked',
        title: 'School run',
        start: { day, minute: 720 },
        durationMinutes: 30,
        away: true
      }
    ],
    activityRequirements: [
      { id: 'requirement', activityId: 'cook', name: 'Planning-only pepper', quantity: 3 }
    ],
    availability: {},
    recipes: []
  };
}
async function load(page: Page, plan = fixture()) {
  let document: PlanDocument = {
    schemaVersion: 2,
    revision: 0,
    updatedAt: new Date().toISOString(),
    plan: parseKitchenPlan(plan)
  };
  const writes: KitchenPlan[] = [];
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: document });
    const next = route.request().postDataJSON();
    writes.push(next.plan);
    document = { ...document, revision: document.revision + 1, plan: next.plan };
    await route.fulfill({ json: document });
  });
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  return { writes, saved: () => document.plan };
}
const row = (page: Page, id: string) =>
  page.getByRole('dialog').locator(`[data-allocation-id="${id}"]`);
async function open(page: Page, name: string) {
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
}
async function pathIds(page: Page) {
  return page
    .locator('.food-connection')
    .evaluateAll((paths) =>
      paths.flatMap((path) => JSON.parse(path.getAttribute('data-allocation-ids')!)).sort()
    );
}

test('meal focus is direct, named paths preserve parts, and rows override pinned focus without changing selection', async ({
  page
}) => {
  const { writes } = await load(page);
  await page.getByRole('heading', { name: 'Your plan', exact: true }).hover();
  await expect(page.locator('.calendar-connections path')).toHaveCount(0);
  await open(page, 'Pepper lunch');
  await expect(page.getByTestId('activity-cook')).toHaveClass(/related/);
  await expect(page.getByTestId('activity-side')).toHaveClass(/related/);
  await expect(page.getByTestId('activity-sibling')).not.toHaveClass(/related/);
  await expect(page.getByTestId('activity-other')).not.toHaveClass(/related/);
  await expect(page.getByTestId('food-raw')).not.toHaveClass(/related/);
  await expect
    .poll(() => pathIds(page))
    .toEqual(['lunch-end', 'lunch-ingredient', 'lunch-start', 'side-meal']);
  // Short parallel routes omit labels rather than making a typography-driven detour.
  await expect(row(page, 'lunch-start')).toContainText('Pepper stew');
  await expect(row(page, 'side-meal')).toContainText('Side salad');
  await row(page, 'lunch-end').getByLabel('Amount of Pepper stew used').focus();
  await expect.poll(() => pathIds(page)).toEqual(['lunch-end']);
  await expect(page.getByTestId('activity-meal')).toHaveClass(/selected/);
  await expect(page.getByTestId('activity-side')).not.toHaveClass(/related/);
  await expect(row(page, 'lunch-end')).toContainText('Eat at end');
  await page.getByLabel('Activity name', { exact: true }).focus();
  await page.getByRole('dialog').getByText('Food allocated here', { exact: true }).hover();
  await expect
    .poll(() => pathIds(page))
    .toEqual(['lunch-end', 'lunch-ingredient', 'lunch-start', 'side-meal']);
  await row(page, 'lunch-start').hover();
  await expect.poll(() => pathIds(page)).toEqual(['lunch-start']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.food-connection')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('incoming source, named food, outgoing consumer and raw-use navigation are read-only', async ({
  page
}) => {
  const { writes } = await load(page);
  await open(page, 'Pepper lunch');
  await row(page, 'lunch-start')
    .getByRole('button', { name: /^From Make pepper dinner/ })
    .click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Make pepper dinner');
  await expect(page.getByRole('dialog')).toContainText('Ingredients needed');
  await expect(page.getByRole('dialog')).toContainText('Planning notes');
  await page.getByRole('dialog').getByRole('button', { name: 'Pepper stew', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Prepared food', exact: true })).toContainText(
    'Planned food output'
  );
  await expect(page.getByLabel('Planned quantity')).toHaveValue('20');
  await row(page, 'lunch-end')
    .getByRole('button', { name: /^Pepper lunch/ })
    .click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Pepper lunch');
  await row(page, 'lunch-start')
    .getByRole('button', { name: /^From Make pepper dinner/ })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Raw peppers', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Ingredient', exact: true })).toBeVisible();
  await expect(page.getByTestId('activity-cook')).toHaveClass(/related/);
  await expect(page.getByTestId('activity-other')).toHaveClass(/related/);
  await expect(page.getByTestId('activity-meal')).not.toHaveClass(/related/);
  await expect(page.locator('.food-connection')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('offscreen overnight source reveals its readiness segment in the calendar, not the document', async ({
  page
}) => {
  const { writes } = await load(page);
  await open(page, 'Make pepper dinner');
  const bodyTop = await page.evaluate(() => window.scrollY);
  await row(page, 'input')
    .getByRole('button', { name: /^From Overnight stock source/ })
    .click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue(
    'Overnight stock source'
  );
  await expect(page.getByLabel('Jump to date')).toHaveValue(addDays(day, -7));
  const segment = page.locator(`[data-time-day="${addDays(day, -7)}"] [data-activity-id="source"]`);
  await expect(segment).toBeVisible();
  const visible = await segment.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const scroll = document.querySelector('.calendar-scroll')!.getBoundingClientRect();
    return bounds.bottom > scroll.top + 54 && bounds.top < scroll.bottom;
  });
  expect(visible).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(bodyTop);
  expect(writes).toEqual([]);
});

test('in-range overnight source navigation chooses the readiness segment rather than the first card', async ({
  page
}) => {
  const plan = fixture();
  plan.activities.find((item) => item.id === 'source')!.start.day = day;
  const { writes } = await load(page, plan);
  await open(page, 'Make pepper dinner');
  await row(page, 'input')
    .getByRole('button', { name: /^From Overnight stock source/ })
    .click();
  await expect(page.getByLabel('Jump to date')).toHaveValue(day);
  await expect(page.getByTestId('activity-source')).toHaveCount(2);
  const segment = page.locator(`[data-time-day="${addDays(day, 1)}"] [data-activity-id="source"]`);
  expect(
    await segment.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const scroll = document.querySelector('.calendar-scroll')!.getBoundingClientRect();
      return rect.bottom > scroll.top + 54 && rect.top < scroll.bottom;
    })
  ).toBe(true);
  expect(
    await page.locator('.calendar-scroll').evaluate((element) => element.scrollTop)
  ).toBeLessThan(90);
  expect(writes).toEqual([]);
});

test('exact offscreen context links navigate without losing pending meal placement', async ({
  page
}, info) => {
  const { writes } = await load(page);
  const cook = page.getByTestId('activity-cook');
  await cook.hover();
  const incoming = page
    .getByRole('region', { name: 'Food relationships outside this range' })
    .getByRole('button', {
      name: /^0\.5 Prepared stock.*From Overnight stock source/
    });
  await expect(incoming).toBeVisible();
  // Keyboard activation is also available on touch layouts without relying on persistent hover.
  await incoming.focus();
  await incoming.press('Enter');
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue(
    'Overnight stock source'
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await open(page, 'Make pepper dinner');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Plan a meal from this', exact: true })
    .last()
    .click();
  await expect(page.locator('.placement-banner')).toBeVisible();
  const outgoing = page
    .getByRole('region', { name: 'Food relationships outside this range' })
    .getByRole('button', { name: /^0\.5 Pepper sauce.*To Far future dinner/ });
  await outgoing.scrollIntoViewIfNeeded();
  expect(
    await outgoing.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      );
    })
  ).toBe(true);
  if (info.project.name === 'phone') await outgoing.tap();
  else await outgoing.click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Far future dinner');
  await expect(page.getByLabel('Jump to date')).toHaveValue(addDays(day, 12));
  await expect(page.locator('.placement-banner')).toContainText('Pepper sauce');
  expect(writes).toEqual([]);
});

test('checks open in the canonical inspector without moving the calendar or writing', async ({
  page
}) => {
  for (const viewport of [
    { width: 2066, height: 812 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    const plan = fixture();
    const { writes } = await load(page, plan);
    const checks = page.locator('.heading-actions').getByRole('button', {
      name: `Checks ${validateKitchenPlan(plan).length}`
    });
    await expect(checks).toBeVisible();
    const bounds = await checks.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    const calendarTop = await page
      .locator('.calendar-shell')
      .evaluate((node) => node.getBoundingClientRect().top);
    await checks.click();
    const dialog = page.getByRole('dialog', { name: 'Things to check' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-warning-code]')).toHaveCount(
      validateKitchenPlan(plan).length
    );
    await dialog.locator('[data-warning-code]').last().scrollIntoViewIfNeeded();
    await expect(dialog.locator('[data-warning-code]').last()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(checks).toBeFocused();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.locator('.calendar-shell').evaluate((node) => node.getBoundingClientRect().top)
    ).toBe(calendarTop);
    expect(writes).toEqual([]);
    expect(await page.locator('main > .plan-issues').count()).toBe(0);
    const headingGap = await page.locator('.workspace-heading').evaluate((node) => {
      const heading = node.getBoundingClientRect();
      const workspace = document.querySelector('.workspace')!.getBoundingClientRect();
      return workspace.top - heading.bottom;
    });
    expect(headingGap).toBe(viewport.width < 700 ? 12 : 16);
  }
});

test('warning targets reveal consumption, producer readiness and blockers without writing', async ({
  page
}) => {
  const { writes } = await load(page);
  const checks = page.locator('.heading-actions').getByRole('button', { name: /^Checks / });
  await checks.click();
  const warning = page
    .getByRole('dialog', { name: 'Things to check' })
    .locator('[data-warning-code="BEFORE_READY"]');
  await warning.getByRole('button', { name: /^Review meal timing:/ }).click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Too early dinner');
  await page.keyboard.press('Escape');
  await checks.click();
  await warning.getByRole('button', { name: 'Review preparation timing', exact: true }).click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Make pepper dinner');
  await page.keyboard.press('Escape');
  await checks.click();
  await page
    .getByRole('dialog', { name: 'Things to check' })
    .locator('[data-warning-code="BLOCKED_TIME"]')
    .getByRole('button', { name: 'Review blocked time', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Blocked time', exact: true })).toBeVisible();
  const before = await page
    .locator('.calendar-scroll')
    .evaluate((node) => [node.scrollTop, node.scrollLeft]);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Edit blocker School run', exact: true })
  ).toBeFocused();
  expect(
    await page.locator('.calendar-scroll').evaluate((node) => [node.scrollTop, node.scrollLeft])
  ).toEqual(before);
  expect(writes).toEqual([]);
});

test('endpoint links stay exact when the other activity has a card but its endpoint is outside the range', async ({
  page
}) => {
  const plan = fixture();
  plan.activities = [
    activity('cook', 'Monday producer', 0, 720),
    activity('meal', 'Sunday consumer', 6, 1380, 180, 'meal')
  ];
  plan.batches = [batch('main', 'Late stew', 'cook')];
  plan.allocations = [allocation('late', 'main', 'meal', 'eat', 'end')];
  plan.ingredientUses = [];
  plan.activityRequirements = [];
  const { writes } = await load(page, plan);
  await page.getByTestId('activity-cook').hover();
  await expect.poll(() => pathIds(page)).not.toContain('late');
  await expect(page.getByTestId('activity-meal')).toHaveCount(1);
  const outgoing = page
    .getByRole('region', { name: 'Food relationships outside this range' })
    .getByRole('button', {
      name: /^0\.5 Late stew.*To Sunday consumer/
    });
  await expect(outgoing).toContainText('02:00');
  await outgoing.focus();
  await outgoing.press('Enter');
  await expect(page.getByLabel('Jump to date')).toHaveValue(addDays(day, 7));
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Sunday consumer');
  await expect(
    page.locator(`[data-time-day="${addDays(day, 7)}"] [data-activity-id="meal"]`)
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test('source readiness outside the range produces a From link, not a fabricated path', async ({
  page
}) => {
  const plan = fixture();
  plan.activities = [
    activity('cook', 'Sunday producer', 6, 1380, 180),
    activity('meal', 'Monday consumer', 0, 720, 60, 'meal')
  ];
  plan.batches = [batch('main', 'Late stew', 'cook')];
  plan.allocations = [allocation('late', 'main', 'meal')];
  plan.ingredientUses = [];
  plan.activityRequirements = [];
  const { writes } = await load(page, plan);
  await page.getByTestId('activity-meal').hover();
  await expect.poll(() => pathIds(page)).not.toContain('late');
  await expect(page.getByTestId('activity-cook')).toHaveCount(1);
  const incoming = page
    .getByRole('region', { name: 'Food relationships outside this range' })
    .getByRole('button', {
      name: /^0\.5 Late stew.*From Sunday producer/
    });
  await expect(incoming).toContainText('02:00');
  await incoming.focus();
  await incoming.press('Enter');
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Sunday producer');
  await expect(page.getByLabel('Jump to date')).toHaveValue(addDays(day, 7));
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Sunday producer');
  expect(writes).toEqual([]);
});

test('in-range overnight endpoints still route', async ({ page }) => {
  const plan = fixture();
  plan.activities = [
    activity('cook', 'Overnight producer', 0, 1380, 180),
    activity('meal', 'Monday consumer', 1, 720, 60, 'meal')
  ];
  plan.batches = [batch('main', 'Late stew', 'cook')];
  plan.allocations = [allocation('late', 'main', 'meal')];
  plan.ingredientUses = [];
  plan.activityRequirements = [];
  const { writes } = await load(page, plan);
  await open(page, 'Monday consumer');
  await expect.poll(() => pathIds(page)).toContain('late');
  expect(writes).toEqual([]);
});

test('exact midnight at the range boundary routes on its preceding segment', async ({ page }) => {
  const plan = fixture();
  plan.activities = [
    activity('cook', 'Midnight producer', 6, 1380, 60),
    activity('meal', 'Sunday consumer', 6, 720, 60, 'meal')
  ];
  plan.batches = [batch('main', 'Midnight stew', 'cook')];
  plan.allocations = [allocation('midnight', 'main', 'meal')];
  plan.ingredientUses = [];
  plan.activityRequirements = [];
  const { writes } = await load(page, plan);
  await open(page, 'Sunday consumer');
  await expect.poll(() => pathIds(page)).toContain('midnight');
  expect(writes).toEqual([]);
});

test('keyboard relationship navigation restores focus to the producer edit button after Escape', async ({
  page
}) => {
  const plan = fixture();
  plan.activities = [
    activity('cook', 'Sunday carryover', -1, 1410, 90),
    activity('meal', 'Monday lunch', 0, 780, 60, 'meal')
  ];
  plan.batches = [batch('main', 'Carryover stew', 'cook')];
  plan.allocations = [allocation('late', 'main', 'meal')];
  plan.ingredientUses = [];
  plan.activityRequirements = [];
  const { writes } = await load(page, plan);
  const lunch = page.getByRole('button', { name: 'Edit Monday lunch', exact: true });
  await lunch.focus();
  await lunch.press('Enter');
  await row(page, 'late')
    .getByRole('button', { name: /^From Sunday carryover/ })
    .click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Sunday carryover');
  const before = await page
    .locator('.calendar-scroll')
    .evaluate((node) => [node.scrollTop, node.scrollLeft]);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Edit Sunday carryover', exact: true })
  ).toBeFocused();
  await expect(page.getByTestId('activity-cook')).not.toHaveClass(/selected|related/);
  await expect(page.locator('.food-connection')).toHaveCount(0);
  expect(
    await page.locator('.calendar-scroll').evaluate((node) => [node.scrollTop, node.scrollLeft])
  ).toEqual(before);
  expect(writes).toEqual([]);
});

test('pending field blur commits before relationship navigation and parallel allocation edits retain metadata', async ({
  page
}) => {
  const { writes, saved } = await load(page);
  await open(page, 'Pepper lunch');
  const amount = row(page, 'lunch-end').getByLabel('Amount of Pepper stew used');
  await amount.fill('1.25');
  // Programmatic button activation deliberately leaves the input focused: navigation must flush it.
  await row(page, 'lunch-start')
    .getByRole('button', { name: 'Pepper stew', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog', { name: 'Prepared food', exact: true })).toBeVisible();
  await expect
    .poll(() => saved().allocations.find((item) => item.id === 'lunch-end')?.quantity)
    .toBe(1.25);
  const preparedAmount = row(page, 'lunch-end').getByLabel('Amount assigned to Pepper lunch');
  await preparedAmount.fill('1.75');
  await preparedAmount.press('Tab');
  await expect
    .poll(() => saved().allocations.find((item) => item.id === 'lunch-end')?.quantity)
    .toBe(1.75);
  await row(page, 'lunch-ingredient')
    .getByRole('button', { name: /^Unassign from Pepper lunch,/ })
    .click();
  await page.getByLabel('Use in activity').selectOption('meal');
  await page.getByLabel('Amount to assign').fill('0.75');
  await page.getByRole('button', { name: 'Use here', exact: true }).click();
  await expect
    .poll(() => saved().allocations.find((item) => item.id === 'lunch-start')?.quantity)
    .toBe(1.25);
  const original = fixture();
  expect(saved().allocations).toEqual(
    original.allocations
      .filter((item) => item.id !== 'lunch-ingredient')
      .map((item) =>
        item.id === 'lunch-start'
          ? { ...item, quantity: 1.25 }
          : item.id === 'lunch-end'
            ? { ...item, quantity: 1.75 }
            : item
      )
  );
  expect(saved().activities).toEqual(original.activities);
  expect(saved().batches).toEqual(original.batches);
  expect(saved().activityRequirements).toEqual(original.activityRequirements);
  expect(writes.length).toBeGreaterThan(0);
});
