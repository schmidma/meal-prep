import { test, expect, type Page, type Locator } from '@playwright/test';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
import { createKitchenPlan, type KitchenPlan } from '../src/lib/kitchen';
import type { PlanDocument } from '../src/lib/plan-document';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

const day = startOfWeek(todayDay());
const longName = 'Roasted vegetables with ' + 'chickpeas and potatoes '.repeat(44) + 'IDENTITY END';
function fixture(): KitchenPlan {
  const plan = createKitchenPlan(day);
  plan.activities = Array.from({ length: 25 }, (_, index) => ({
    id: `meal-${index}`,
    title: `Lunch ${index + 1}`,
    kind: 'meal',
    start: { day: addDays(day, index), minute: 600 },
    elapsedMinutes: 30,
    handsOnMinutes: 0,
    requiresHome: false,
    notes: ''
  }));
  plan.batches = [
    {
      id: 'bread',
      name: 'Bread',
      quantity: 100,
      unit: '',
      source: { kind: 'existing', availableAt: { day: addDays(day, 26), minute: 600 } }
    }
  ];
  plan.allocations = plan.activities.map((activity, index) => ({
    id: `use-${index}`,
    batchId: 'bread',
    activityId: activity.id,
    quantity: 0.25,
    purpose: 'eat',
    when: 'start'
  }));
  plan.ingredients = [{ id: 'stock', name: 'Stock', quantity: 1, unit: '' }];
  plan.ingredientUses = [];
  plan.blockers = [
    { id: 'busy', title: 'Meeting', start: { day, minute: 600 }, durationMinutes: 30, away: true }
  ];
  plan.recipes = [
    {
      id: 'recipe',
      name: longName,
      yieldQuantity: 4,
      durationMinutes: 30,
      ingredients: [],
      instructions: ''
    }
  ];
  plan.activityRequirements = [];
  plan.availability = {};
  return plan;
}
async function load(page: Page, plan: KitchenPlan) {
  let document: PlanDocument = {
    schemaVersion: 2,
    revision: 0,
    updatedAt: new Date().toISOString(),
    plan
  };
  const writes: KitchenPlan[] = [];
  await page.context().route('**/api/plan', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: document });
    if (route.request().method() !== 'PUT') return route.abort();
    const next = route.request().postDataJSON();
    writes.push(next.plan);
    document = { ...document, revision: document.revision + 1, plan: next.plan };
    await route.fulfill({ json: document });
  });
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  return writes;
}
const popup = (page: Page) => page.getByRole('dialog');
async function openChecks(page: Page) {
  await page
    .locator('.heading-actions')
    .getByRole('button', { name: /^Checks / })
    .click();
}
async function outsideScroll(page: Page) {
  return page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
    calendar: Array.from(document.querySelectorAll('.calendar-scroll')).map((node) => [
      node.scrollLeft,
      node.scrollTop
    ])
  }));
}
async function atEnding(region: Locator) {
  await expect
    .poll(() => region.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(2);
  // The actual final text range, not just nonzero scrolling, must be visible.
  expect(
    await region.evaluate((node) => {
      const text = node.firstChild!;
      const range = document.createRange();
      range.setStart(text, text.textContent!.length - 12);
      range.setEnd(text, text.textContent!.length);
      const end = range.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return end.top >= box.top && end.bottom <= box.bottom + 1;
    })
  ).toBe(true);
}

for (const entity of ['activity', 'food', 'block', 'recipe'] as const) {
  test(`${entity} editable identity has a bounded full-name disclosure in collapsed and expanded phone inspectors`, async ({
    page
  }) => {
    const plan = fixture();
    if (entity === 'activity') plan.activities[0].title = longName;
    if (entity === 'food') plan.batches[0].name = longName;
    if (entity === 'block') plan.blockers[0].title = longName;
    await page.setViewportSize({ width: 390, height: 844 });
    const writes = await load(page, plan);
    await openChecks(page);
    if (entity === 'activity')
      await popup(page)
        .getByRole('button', { name: /^Review meal timing:/ })
        .first()
        .click();
    if (entity === 'food')
      await popup(page).getByRole('button', { name: 'Review food readiness' }).click();
    if (entity === 'block') {
      await popup(page).getByRole('button', { name: 'Schedule 1', exact: true }).click();
      await popup(page).getByRole('button', { name: 'Review blocked time' }).click();
    }
    if (entity === 'recipe') {
      await popup(page).getByRole('button', { name: 'Recipes', exact: true }).click();
      await expect(popup(page).locator('.inspector-identity')).toHaveCount(0);
      await popup(page).locator('.recipe-library-list button').click();
    }
    const input = popup(page).locator('.edit-title');
    await expect(input).toHaveValue(longName);
    await popup(page).locator('.inspector-identity summary').click();
    const region = popup(page).getByRole('region', { name: 'Full name', exact: true });
    await expect(region).toHaveText(longName);
    const before = await outsideScroll(page);
    for (const expanded of [false, true]) {
      if (expanded) await popup(page).getByRole('button', { name: 'Expand details' }).click();
      await region.focus();
      await page.keyboard.press('End');
      await atEnding(region);
      for (const name of [
        'Close details',
        'Recipes',
        expanded ? 'Reduce details' : 'Expand details',
        entity === 'recipe' ? 'All recipes' : 'Back to checks'
      ])
        await expect(popup(page).getByRole('button', { name, exact: true })).toBeInViewport({
          ratio: 1
        });
      expect((await popup(page).locator('.inspector-body').boundingBox())!.height).toBeGreaterThan(
        100
      );
      expect(await outsideScroll(page)).toEqual(before);
    }
    if (entity === 'recipe') {
      await popup(page).getByRole('button', { name: 'All recipes' }).click();
      await expect(popup(page).locator('.inspector-identity')).toHaveCount(0);
      await popup(page).locator('.recipe-library-list button').click();
      await expect(popup(page).locator('.inspector-identity summary')).toBeVisible();
    }
    expect(writes).toHaveLength(0);
  });
}

test('full identity ending is reachable by wheel and touch without background scroll', async ({
  page,
  isMobile
}) => {
  const plan = fixture();
  plan.activities[0].title = longName;
  const writes = await load(page, plan);
  await openChecks(page);
  await popup(page)
    .getByRole('button', { name: /^Review meal timing:/ })
    .first()
    .click();
  await popup(page).locator('.inspector-identity summary').click();
  const region = popup(page).getByRole('region', { name: 'Full name', exact: true });
  const before = await outsideScroll(page);
  const bounds = (await region.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 10000);
  await atEnding(region);
  await page.mouse.wheel(0, 10000);
  expect(await outsideScroll(page)).toEqual(before);
  if (isMobile) {
    await region.evaluate((node) => {
      node.scrollTop = 0;
    });
    const client = await page.context().newCDPSession(page);
    for (let swipe = 0; swipe < 35; swipe++) {
      if (
        await region.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop < 2)
      )
        break;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: bounds.y + bounds.height - 4 }]
      });
      for (let step = 1; step <= 6; step++)
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: bounds.y + bounds.height - 4 - step * 10 }]
        });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await atEnding(region);
    await client.detach();
    expect(await outsideScroll(page)).toEqual(before);
  }
  expect(writes).toHaveLength(0);
});

test('identity measures overflow on resize, cleans up for short titles, and preserves pending edits', async ({
  page
}) => {
  const plan = fixture();
  plan.activities[0].title = 'Wide WWWWWWWWWWWWWWWWWWWW';
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await load(page, plan);
  await openChecks(page);
  await popup(page)
    .getByRole('button', { name: /^Review meal timing:/ })
    .first()
    .click();
  await expect(popup(page).locator('.inspector-identity summary')).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(popup(page).locator('.inspector-identity')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(popup(page).locator('.inspector-identity summary')).toBeVisible();
  const input = popup(page).getByLabel('Activity name');
  await input.fill('');
  await input.press('Tab');
  await expect(input).toHaveValue(plan.activities[0].title);
  await expect(popup(page).locator('.inspector-identity summary')).toBeVisible();
  expect(writes).toHaveLength(0);
  const pending = 'Pending ' + 'W'.repeat(70);
  await input.fill(pending);
  await page.setViewportSize({ width: 800, height: 844 });
  await expect(input).toHaveValue(pending);
  expect(writes).toHaveLength(0);
  await popup(page).locator('.inspector-identity summary').click();
  await expect(popup(page).getByRole('region', { name: 'Full name', exact: true })).toHaveText(
    pending
  );
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].activities[0].title).toBe(pending);
  await input.fill('Short');
  await expect(popup(page).locator('.inspector-identity')).toHaveCount(0);
  await popup(page).getByRole('button', { name: 'Back to checks' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].activities[0].title).toBe('Short');
});

for (const source of ['existing', 'activity'] as const) {
  test(`shared ${source} readiness action precedes all 25 dated uses and reveals its timing without writes`, async ({
    page
  }) => {
    const plan = fixture();
    if (source === 'activity') {
      plan.activities.push({
        ...plan.activities[0],
        id: 'cook',
        title: 'Preparation',
        kind: 'cook',
        start: { day: addDays(day, 26), minute: 600 }
      });
      plan.batches[0].source = { kind: 'activity', activityId: 'cook' };
    }
    const writes = await load(page, plan);
    await openChecks(page);
    await popup(page).getByRole('button', { name: 'Food 25', exact: true }).click();
    const card = popup(page).locator('[data-warning-code="BEFORE_READY"]');
    await expect(card.locator('li')).toHaveCount(25);
    const name = source === 'existing' ? 'Review food readiness' : 'Review preparation timing';
    const action = card.getByRole('button', { name, exact: true });
    await expect(action).toHaveCount(1);
    // A compact drawer may need to scroll past the introductory copy, never the uses.
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport({ ratio: 0.99 });
    expect((await card.locator('.check-rows').boundingBox())!.y).toBeGreaterThanOrEqual(
      (await action.boundingBox())!.y + (await action.boundingBox())!.height
    );
    expect(
      await card.evaluate(
        (node) =>
          node
            .querySelector('.check-other-actions')!
            .compareDocumentPosition(node.querySelector('.check-rows')!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBeTruthy();
    await action.click();
    const time = page.getByLabel(source === 'existing' ? 'Food available time' : 'Activity time', {
      exact: true
    });
    await expect(time).toBeFocused();
    await expect(time).toBeInViewport({ ratio: 1 });
    await expect(time).toHaveValue('10:00');
    if (source === 'existing') {
      await time.fill('11:15');
      await page.getByLabel('Food available date').click();
      await expect(time).toHaveValue('11:15');
      await expect.poll(() => writes.length).toBe(1);
    }
    await popup(page).getByRole('button', { name: 'Back to checks' }).click();
    await expect(action).toBeFocused();
    await expect(action).toBeInViewport({ ratio: 1 });
    await expect(popup(page).getByRole('button', { name: 'Food 25', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: /^Review meal timing:/ }).first()).toBeFocused();
    expect(writes.length).toBe(source === 'existing' ? 1 : 0);
  });
}

test('thirds stay compact and approximate in facts while editable quantities remain exact', async ({
  page
}) => {
  const plan = fixture();
  plan.ingredientUses = [
    { id: 'raw', ingredientId: 'stock', activityId: 'meal-0', quantity: 4 / 3 }
  ];
  const writes = await load(page, plan);
  await openChecks(page);
  const facts = popup(page).locator('[data-warning-code="OVER_ALLOCATED_INGREDIENT"] .check-facts');
  await expect(facts.locator('dd')).toHaveText(['1', '≈1.33333', '≈0.333333']);
  for (const fact of await facts.locator('dd').all()) {
    expect(await fact.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await fact.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('nowrap');
  }
  await popup(page).getByRole('button', { name: 'Review quantity & assignments' }).click();
  await expect(page.getByLabel(/^Amount assigned to Lunch 1,/)).toHaveValue(String(4 / 3));
  await expect(page.getByLabel('Amount at home', { exact: true })).toHaveValue('1');
  await popup(page).getByRole('button', { name: 'Back to checks' }).click();
  expect(writes).toHaveLength(0);
});
