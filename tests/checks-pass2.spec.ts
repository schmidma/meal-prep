import { test, expect, type Page, type Locator } from '@playwright/test';
import { startOfWeek, todayDay, addDays } from '../src/lib/calendar';
import { createKitchenPlan, type KitchenPlan } from '../src/lib/kitchen';
import { checkTime } from '../src/lib/plan-checks';
import { fullTime } from '../src/lib/relationships';
import type { PlanDocument } from '../src/lib/plan-document';

const day = startOfWeek(todayDay());
function fixture(count = 18): KitchenPlan {
  const plan = createKitchenPlan(day);
  plan.activities = Array.from({ length: count }, (_, i) => ({
    id: `meal-${i}`,
    title: `Lunch ${i + 1}`,
    start: { day: addDays(day, i), minute: 600 },
    elapsedMinutes: 30,
    handsOnMinutes: 0,
    requiresHome: false,
    kind: 'meal',
    notes: ''
  }));
  plan.batches = [
    {
      id: 'bread',
      name: 'Bread',
      quantity: 100,
      unit: 'legacy units',
      source: { kind: 'existing', availableAt: { day: addDays(day, count + 1), minute: 600 } }
    }
  ];
  plan.allocations = plan.activities.map((activity, i) => ({
    id: `use-${i}`,
    activityId: activity.id,
    batchId: 'bread',
    quantity: 0.25,
    purpose: 'eat',
    when: 'start'
  }));
  plan.ingredients = [{ id: 'carrots', name: 'Carrots', quantity: 4, unit: 'g' }];
  plan.ingredientUses = [];
  plan.blockers = [];
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
const dialog = (page: Page) => page.getByRole('dialog');
const openChecks = (page: Page) =>
  page
    .locator('.heading-actions')
    .getByRole('button', { name: /^Checks / })
    .click();
async function visibleInBody(action: Locator) {
  await expect(action).toBeFocused();
  const rect = await action.boundingBox();
  const body = await action
    .locator('xpath=ancestor::*[contains(@class,"inspector-body")]')
    .boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(body!.y);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(body!.y + body!.height);
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

for (const revealed of [false, true]) {
  test(`date then time remains editable in ${revealed ? 'check-revealed' : 'manually opened'} schedule`, async ({
    page
  }) => {
    const writes = await load(page, fixture(2));
    if (revealed) {
      await openChecks(page);
      await dialog(page)
        .getByRole('button', { name: /^Review meal timing:/ })
        .first()
        .click();
      await expect(page.getByLabel('Activity time')).toBeFocused();
    } else {
      await page.getByRole('button', { name: 'Agenda', exact: true }).click();
      await page.getByTestId('agenda-meal-0').click();
      await dialog(page).locator('.move-details summary').click();
    }
    await page.getByLabel('Activity date').fill(addDays(day, 1));
    await page.getByLabel('Activity time').fill('11:15');
    await page.getByLabel('Duration minutes').click();
    await expect(page.getByLabel('Activity date')).toHaveValue(addDays(day, 1));
    await expect(page.getByLabel('Activity time')).toHaveValue('11:15');
    await expect(dialog(page).locator('.move-details')).toHaveAttribute('open', '');
    await expect
      .poll(() => writes.at(-1)?.activities[0].start)
      .toEqual({ day: addDays(day, 1), minute: 675 });
  });
}

test('removing one contributor keeps the remaining shortage live and returns to its visible action', async ({
  page
}) => {
  const plan = fixture(2);
  plan.ingredientUses = [
    { id: 'u1', ingredientId: 'carrots', activityId: 'meal-0', quantity: 5 },
    { id: 'u2', ingredientId: 'carrots', activityId: 'meal-1', quantity: 2 }
  ];
  await load(page, plan);
  await openChecks(page);
  const action = dialog(page).getByRole('button', { name: 'Review quantity & assignments' });
  await action.click();
  await expect(dialog(page)).toContainText('3 over-assigned');
  await dialog(page)
    .getByRole('button', { name: /^Unassign from Lunch 2,/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('Still flagged: Carrots: 1 short');
  await visibleInBody(action);
});

for (const resolve of [false, true]) {
  test(`return from ${resolve ? 'resolved' : 'unresolved'} middle readiness row preserves visible focus and ordinary Tab continuation`, async ({
    page
  }) => {
    const writes = await load(page, fixture());
    await openChecks(page);
    await dialog(page).getByRole('button', { name: 'Food 18', exact: true }).click();
    const actions = dialog(page).getByRole('button', { name: /^Review meal timing:/ });
    await actions.nth(9).click();
    if (resolve) {
      await page.getByLabel('Activity date').fill(addDays(day, 20));
      await page.getByLabel('Activity time').click();
    }
    const before = await outsideScroll(page);
    await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
    await expect(
      dialog(page).getByRole('button', { name: `Food ${resolve ? 17 : 18}`, exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    const feedback = dialog(page).getByRole('status');
    await expect(feedback).toBeInViewport({ ratio: 1 });
    await expect(feedback).toContainText(`${resolve ? 'Resolved' : 'Still flagged'}: Lunch 10`);
    await expect(feedback.locator('.check-return-meta').first()).toHaveText(
      `${resolve ? 'Originally needed' : 'Needed'}: ${checkTime({ day: addDays(day, 9), minute: 600 })}`
    );
    await expect(feedback).toContainText('17 other uses still need review');
    await expect(
      feedback.locator('xpath=ancestor::*[contains(@class,"inspector-header")]')
    ).toHaveCount(1);
    await visibleInBody(actions.nth(9));
    const focusedRow = actions.nth(9).locator('..');
    await expect(focusedRow).toContainText(resolve ? 'Lunch 11' : 'Lunch 10');
    const rowBounds = await focusedRow.boundingBox();
    const bodyBounds = await dialog(page).locator('.inspector-body').boundingBox();
    expect(rowBounds!.y).toBeGreaterThanOrEqual(bodyBounds!.y);
    expect(await outsideScroll(page)).toEqual(before);
    await page.keyboard.press('Tab');
    await visibleInBody(actions.nth(10));
    expect(await outsideScroll(page)).toEqual(before);
    expect(writes.length).toBe(resolve ? 1 : 0);
  });
}

test('long same-name partial resolution keeps date and remaining count visible in expanded phone header', async ({
  page
}) => {
  const plan = fixture(2);
  const longTitle =
    'Extremely elaborate baked breakfast with more descriptive words than can fit in a compact header';
  plan.activities.forEach((activity) => (activity.title = longTitle));
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, plan);
  await openChecks(page);
  await dialog(page).getByRole('button', { name: 'Expand details' }).click();
  await dialog(page)
    .getByRole('button', { name: /^Review meal timing:/ })
    .first()
    .click();
  await page.getByLabel('Activity date').fill(addDays(day, 3));
  await page.getByLabel('Activity time').click();
  const before = await outsideScroll(page);
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  const status = dialog(page).getByRole('status');
  await expect(status).toContainText('Resolved');
  const metadata = status.locator('.check-return-meta');
  await expect(metadata.first()).toHaveText(
    `Originally needed: ${checkTime({ day, minute: 600 })}`
  );
  await expect(metadata.nth(1)).toHaveText('1 other use still needs review');
  const header = dialog(page).locator('.inspector-header');
  for (const field of [metadata.first(), metadata.nth(1)]) {
    const bounds = (await field.boundingBox())!;
    const headerBounds = (await header.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(headerBounds.y);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(headerBounds.y + headerBounds.height);
    await expect(field).toBeInViewport({ ratio: 1 });
  }
  await expect(dialog(page).getByRole('button', { name: 'Close details' })).toBeInViewport();
  const disclosure = status.locator('details');
  await expect(disclosure.getByText(longTitle)).toBeHidden();
  await disclosure.locator('summary').click();
  await expect(disclosure.getByText(longTitle)).toBeVisible();
  const action = dialog(page).getByRole('button', { name: /^Review meal timing:/ });
  await action.focus();
  await visibleInBody(action);
  await page.keyboard.press('Shift+Tab');
  await expect(dialog(page).getByRole('button', { name: 'Review food readiness' })).toBeFocused();
  expect(await outsideScroll(page)).toEqual(before);
});

test('900-character meal identity scrolls inside the phone header without covering controls or scrolling the page', async ({
  page
}) => {
  const plan = fixture(2);
  const title = 'A very long meal name ' + 'roasted chickpeas and potatoes '.repeat(32);
  plan.activities.forEach((activity) => (activity.title = title));
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, plan);
  await openChecks(page);
  await dialog(page).getByRole('button', { name: 'Expand details' }).click();
  await dialog(page)
    .getByRole('button', { name: /^Review meal timing:/ })
    .first()
    .click();
  const before = await outsideScroll(page);
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  const popup = dialog(page);
  const status = popup.getByRole('status');
  await expect(status.locator('.check-return-meta').first()).toBeInViewport();
  await expect(status.locator('.check-return-meta').nth(1)).toBeInViewport();
  const body = await popup.locator('.inspector-body').boundingBox();
  expect(body!.height).toBeGreaterThan(100);
  const summary = status.getByText('Full name');
  await expect(summary).toBeInViewport();
  await expect(popup.getByRole('button', { name: 'Close details' })).toBeInViewport();
  await expect(popup.getByRole('button', { name: 'Reduce details' })).toBeInViewport();
  await summary.click();
  const full = status.getByRole('region', { name: 'Full name' });
  await expect(full).toHaveText(title);
  expect(await full.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  const fullBounds = (await full.boundingBox())!;
  await page.mouse.move(fullBounds.x + fullBounds.width / 2, fullBounds.y + fullBounds.height / 2);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => full.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await full.focus();
  await page.keyboard.press('End');
  await expect.poll(() => full.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const max = await full.evaluate((node) => node.scrollHeight - node.clientHeight);
  await expect
    .poll(async () => Math.abs((await full.evaluate((node) => node.scrollTop)) - max))
    .toBeLessThanOrEqual(1);
  expect(await outsideScroll(page)).toEqual(before);
  expect((await popup.locator('.inspector-body').boundingBox())!.height).toBeGreaterThan(100);
});

test('long stock identities remain readable after unresolved and resolved returns on phone', async ({
  page
}) => {
  const plan = fixture(1);
  const name = 'Carrots ' + 'from the garden and ready for cooking '.repeat(25) + 'IDENTITY END';
  plan.ingredients[0].name = name;
  plan.allocations = [];
  plan.ingredientUses = [
    { id: 'stock-use', ingredientId: 'carrots', activityId: 'meal-0', quantity: 5 }
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await load(page, plan);
  await openChecks(page);
  for (const resolved of [false, true]) {
    await dialog(page).getByRole('button', { name: 'Review quantity & assignments' }).click();
    if (resolved) {
      await page.getByLabel('Amount at home').fill('5');
      await page.getByLabel('Amount at home').press('Tab');
    }
    const before = await outsideScroll(page);
    await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
    const status = dialog(page).getByRole('status');
    await expect(status).toContainText(resolved ? 'Resolved' : 'Still flagged');
    const summary = status.getByText('Full name', { exact: true });
    await expect(summary).toBeInViewport({ ratio: 1 });
    await summary.click();
    const full = status.getByRole('region', { name: 'Full name', exact: true });
    await expect(full).toContainText(name);
    await full.focus();
    await page.keyboard.press('End');
    await expect
      .poll(() => full.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(2);
    await expect(dialog(page).getByRole('button', { name: 'Close details' })).toBeInViewport({
      ratio: 1
    });
    expect((await dialog(page).locator('.inspector-body').boundingBox())!.height).toBeGreaterThan(
      100
    );
    expect(await outsideScroll(page)).toEqual(before);
    await summary.click();
  }
  await expect(dialog(page)).toContainText('All clear');
  expect(writes).toHaveLength(1);
});

test('unresolved readiness feedback follows the current name and time; resolved feedback labels its history', async ({
  page
}) => {
  const plan = fixture(3);
  await load(page, plan);
  await openChecks(page);
  await dialog(page)
    .getByRole('button', { name: /^Review meal timing:/ })
    .first()
    .click();
  await page.getByLabel('Activity name', { exact: true }).fill('Revised lunch');
  await page.getByLabel('Activity date').fill(addDays(day, 1));
  await page.getByLabel('Activity time').fill('10:15');
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  const current = checkTime({ day: addDays(day, 1), minute: 615 });
  const status = dialog(page).getByRole('status');
  await expect(status).toContainText('Still flagged');
  await expect(status.locator('.check-return-title')).toHaveText('Revised lunch');
  await expect(status.locator('.check-return-meta').first()).toHaveText(`Needed: ${current}`);
  await dialog(page)
    .getByRole('button', {
      name: `Review meal timing: Revised lunch, needed ${current}`,
      exact: true
    })
    .click();
  await page.getByLabel('Activity date').fill(addDays(day, 5));
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  await expect(status).toContainText('Resolved');
  await expect(status.locator('.check-return-meta').first()).toHaveText(
    `Originally needed: ${current}`
  );
  await expect(status).toContainText('2 other uses still need review');
});

test('shared readiness feedback remains flagged when only some uses are corrected', async ({
  page
}) => {
  const plan = fixture(3);
  plan.allocations.reverse();
  await load(page, plan);
  await openChecks(page);
  await dialog(page).getByRole('button', { name: 'Review food readiness', exact: true }).click();
  await page.getByLabel('Food available date').fill(addDays(day, 1));
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  const status = dialog(page).getByRole('status');
  await expect(status).toContainText('Still flagged');
  await expect(status).toContainText('1 use still needs review');
  await expect(
    dialog(page).locator('[data-warning-code="BEFORE_READY"] .check-rows strong')
  ).toHaveText(['Lunch 1']);
});

test('same-name stock assignments have dated, distinct amount, removal and group names', async ({
  page
}) => {
  const plan = fixture(12);
  plan.activities.forEach((activity) => (activity.title = 'Repeated lunch'));
  const writes = await load(page, plan);
  await openChecks(page);
  await dialog(page).getByRole('button', { name: 'Review food readiness', exact: true }).click();
  const amounts = dialog(page).getByRole('spinbutton', {
    name: /^Amount assigned to Repeated lunch/
  });
  const removals = dialog(page).getByRole('button', { name: /^Unassign from Repeated lunch/ });
  await expect(amounts).toHaveCount(12);
  await expect(removals).toHaveCount(12);
  for (const controls of [amounts, removals]) {
    const names = await controls.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label')!)
    );
    expect(new Set(names).size).toBe(12);
    names.forEach((name, index) => expect(name).toContain(fullTime(plan.activities[index].start)));
  }
  const groups = await amounts.evaluateAll((nodes) =>
    nodes.map((node) => node.closest('[role="group"]')?.getAttribute('aria-label'))
  );
  groups.forEach((name, index) => expect(name).toContain(fullTime(plan.activities[index].start)));
  expect(writes).toHaveLength(0);
});

test('category counts retain raw warnings and reach schedule without traversing readiness; resolved filter stays honest', async ({
  page
}) => {
  const plan = fixture(80);
  plan.blockers = [
    {
      id: 'busy',
      title: 'Appointment',
      start: { ...plan.activities[0].start },
      durationMinutes: 30,
      away: true
    }
  ];
  await load(page, plan);
  await openChecks(page);
  const categories = dialog(page).getByRole('navigation', { name: 'Check categories' });
  await expect(categories).toContainText('All 81');
  await expect(categories).toContainText('Food 80');
  const schedule = categories.getByRole('button', { name: 'Schedule 1', exact: true });
  await expect(schedule).toBeInViewport({ ratio: 1 });
  await schedule.click();
  await expect(dialog(page).locator('[data-warning-code="BEFORE_READY"]')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Review meal timing', exact: true }).click();
  await page.getByLabel('Activity time').fill('11:00');
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  await expect(categories.getByRole('button', { name: 'Schedule 0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(dialog(page)).toContainText('No schedule checks');
  await categories.getByRole('button', { name: 'All 80', exact: true }).click();
  await expect(dialog(page).locator('[data-warning-code="BEFORE_READY"] li')).toHaveCount(80);
});

test('tray balances display clean precise shortages and decimal exhaustion', async ({ page }) => {
  const plan = fixture(1);
  plan.ingredients = [{ id: 'carrots', name: 'Carrots', quantity: 1, unit: '' }];
  plan.ingredientUses = [
    { id: 'raw', ingredientId: 'carrots', activityId: 'meal-0', quantity: 1.0001 }
  ];
  plan.batches[0].quantity = 1;
  plan.allocations[0].quantity = 1.00000001;
  await load(page, plan);
  await expect(page.getByTestId('food-carrots')).toContainText('0.0001 over-assigned');
  await expect(page.getByTestId('food-bread')).toContainText('0.00000001 over-assigned');
  plan.ingredients[0].quantity = 1;
  plan.ingredientUses[0].quantity = 1.00000001;
  plan.batches[0].quantity = 1;
  plan.allocations[0].quantity = 1.0001;
  await load(page, plan);
  await expect(page.getByTestId('food-carrots')).toContainText('0.00000001 over-assigned');
  await expect(page.getByTestId('food-bread')).toContainText('0.0001 over-assigned');
  plan.ingredients[0].quantity = 0.3;
  plan.ingredientUses[0].quantity = 0.1 + 0.2;
  await load(page, plan);
  await expect(page.getByTestId('food-carrots')).toContainText('All planned');
});

test('blocked-time check reveals an editable blocked schedule without a second disclosure', async ({
  page
}) => {
  const plan = fixture(2);
  plan.batches = [];
  plan.allocations = [];
  plan.blockers = [
    {
      id: 'busy',
      title: 'Meeting',
      start: { day, minute: 600 },
      durationMinutes: 30,
      away: true
    }
  ];
  const writes = await load(page, plan);
  await openChecks(page);
  await dialog(page).getByRole('button', { name: 'Review blocked time' }).click();
  await expect(dialog(page).locator('.move-details')).toHaveAttribute('open', '');
  await expect(page.getByLabel('Blocker time')).toBeFocused();
  await page.getByLabel('Blocker date').fill(addDays(day, 1));
  await page.getByLabel('Blocker time').fill('12:15');
  await page.getByLabel('Blocked minutes').click();
  await expect(dialog(page).locator('.move-details')).toHaveAttribute('open', '');
  await expect
    .poll(() => writes.at(-1)?.blockers[0].start)
    .toEqual({ day: addDays(day, 1), minute: 735 });
});

test('Checks to Recipes follows the existing library in ordinary forward keyboard order', async ({
  page,
  isMobile
}) => {
  test.skip(
    !!isMobile,
    'Desktop autofocus; mobile starts at the dialog for normal header traversal'
  );
  const plan = fixture(1);
  plan.recipes = Array.from({ length: 7 }, (_, i) => ({
    id: `recipe-${i}`,
    name: `Recipe ${i + 1}`,
    yieldQuantity: 2,
    durationMinutes: 30,
    ingredients: [],
    instructions: ''
  }));
  const writes = await load(page, plan);
  await openChecks(page);
  await dialog(page).getByRole('button', { name: 'Recipes', exact: true }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Recipes' })).toBeFocused();
  await page.keyboard.press('Tab'); // Close details in the shared header.
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('button', { name: /Recipe 1 Makes/ })).toBeFocused();
  for (let index = 2; index <= 7; index++) {
    await page.keyboard.press('Tab');
    await expect(
      dialog(page).getByRole('button', { name: new RegExp(`Recipe ${index} Makes`) })
    ).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('New recipe name')).toBeFocused();
  expect(writes).toHaveLength(0);
});

test('decimal exhaustion is neutral in raw, prepared and output balances while real small amounts remain', async ({
  page
}) => {
  const plan = fixture(2);
  plan.ingredients = [
    { id: 'carrots', name: 'Carrots', quantity: 0.3, unit: '' },
    { id: 'tiny', name: 'Tiny stock', quantity: 1e-12, unit: '' }
  ];
  plan.ingredientUses = [0.1, 0.2].map((quantity, index) => ({
    id: `raw-${index}`,
    ingredientId: 'carrots',
    activityId: 'meal-0',
    quantity
  }));
  plan.batches = [
    {
      id: 'bread',
      name: 'Bread',
      quantity: 0.3,
      unit: '',
      source: { kind: 'existing' as const, availableAt: { day, minute: 0 } }
    },
    {
      id: 'made',
      name: 'Made food',
      quantity: 0.3,
      unit: '',
      source: { kind: 'activity' as const, activityId: 'meal-0' }
    }
  ];
  plan.allocations = plan.batches.flatMap((batch) =>
    [0.1, 0.2].map((quantity, index) => ({
      id: `${batch.id}-${index}`,
      batchId: batch.id,
      activityId: batch.id === 'made' ? 'meal-1' : 'meal-0',
      quantity,
      purpose: 'eat' as const,
      when: 'start' as const
    }))
  );
  await load(page, plan);
  await expect(page.getByTestId('food-carrots')).toContainText('All planned');
  await expect(page.getByTestId('food-bread')).toContainText('0 unplanned');
  await expect(page.getByTestId('food-tiny')).not.toContainText('All planned');
  await page.getByTestId('food-carrots').click();
  await expect(dialog(page)).toContainText('0 still unplanned');
  await dialog(page).getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('food-bread').click();
  await expect(dialog(page)).toContainText('0 still unplanned');
  await dialog(page).getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByTestId('agenda-meal-0').click();
  await expect(dialog(page).locator('.batch-heading')).toContainText('0 unplanned');
  await dialog(page).getByRole('button', { name: 'Made food' }).click();
  await expect(dialog(page)).toContainText('0 still unplanned');
  await page.getByLabel('Planned quantity').fill('0.29999999');
  await page.getByLabel('Food name').click();
  await expect(dialog(page)).toContainText('0.00000001 over-assigned');
});
