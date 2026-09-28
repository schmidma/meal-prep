import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { createKitchenPlan } from '../src/lib/kitchen';
import { startOfWeek, todayDay } from '../src/lib/calendar';
import type { PlanDocument } from '../src/lib/plan-document';

const PPM = 1.25;
async function openTray(page: Page) {
  const tray = page.locator('.home-tray');
  await expect(tray).toBeVisible();
}
async function scrollTime(page: Page, hour: number) {
  await page.locator('.calendar-scroll').evaluate((element, top) => {
    element.scrollTop = top;
  }, hour * 75);
}
async function timePoint(page: Page, dayIndex: number, minute: number) {
  await page
    .locator('[data-time-day]')
    .nth(dayIndex)
    .evaluate((element) => {
      const scroll = element.closest('.calendar-scroll')!;
      const rect = element.getBoundingClientRect(),
        bounds = scroll.getBoundingClientRect();
      if (rect.left < bounds.left + 52 || rect.right > bounds.right)
        scroll.scrollLeft = (element as HTMLElement).offsetLeft - 52;
    });
  const rect = await page.locator('[data-time-day]').nth(dayIndex).boundingBox();
  if (!rect) throw new Error('Missing calendar day');
  return { x: rect.x + rect.width * 0.5, y: rect.y + minute * PPM + 4 };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function expectCurryLinks(page: Page) {
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' })
    .click();
  await expect(page.locator('.food-connection')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('.food-connection')
        .evaluateAll((paths) =>
          paths.flatMap((path) => JSON.parse(path.getAttribute('data-allocation-ids')!)).sort()
        )
    )
    .toEqual(['curry-tue', 'curry-wed']);
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.locator('.food-connection')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-time-day]')).toHaveCount(7);
});

test('starts with a clean time grid, ingredient tray, and no forms to complete', async ({
  page
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your plan', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.calendar-connections path')).toHaveCount(0);
  await expect(page.getByTestId('block-block-climbing')).toContainText('18:00 - 21:00');
  expect(
    await page
      .getByTestId('block-block-climbing')
      .evaluate((element) => parseFloat((element as HTMLElement).style.top))
  ).toBe(18 * 60 * PPM);
  expect(
    await page
      .getByTestId('activity-cook-curry')
      .evaluate((element) => parseFloat((element as HTMLElement).style.top))
  ).toBe((19 * 60 + 15) * PPM);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath('planner.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('adds an arbitrary activity with only a name and Enter', async ({ page }) => {
  await scrollTime(page, 9);
  const point = await timePoint(page, 0, 10 * 60);
  await page.mouse.click(point.x, point.y);
  const quick = page.getByRole('dialog', { name: 'Quick add', exact: true });
  await expect(quick.locator('input')).toHaveCount(1);
  await quick.getByLabel('Activity name').fill('Bake a lemon cake');
  await quick.getByLabel('Activity name').press('Enter');
  await expect(quick).toHaveCount(0);
  const card = page.locator('.time-card').filter({ hasText: 'Bake a lemon cake' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Edit Bake a lemon cake' }).click();
  const details = page.getByRole('dialog', { name: 'Activity', exact: true });
  const made = details.getByLabel('Amount made of Bake a lemon cake');
  await made.fill('8');
  await made.press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(card).toContainText('8 Bake a lemon cake');
});

test('quick-adds two paprika, splits them across activities, and highlights their use', async ({
  page
}) => {
  await openTray(page);
  await page.getByLabel('Add ingredient', { exact: true }).fill('2 paprika');
  await page.getByLabel('Add ingredient', { exact: true }).press('Enter');
  const chip = page.locator('[data-food-id^="ingredient-"]').last();
  await expect(chip).toContainText('2 still unplanned');
  await chip.click();
  const popup = page.getByRole('dialog', { name: 'Ingredient', exact: true });
  await popup.getByLabel('Use in activity').selectOption('cook-curry');
  await popup.getByLabel('Amount to assign').fill('1');
  await popup.getByRole('button', { name: 'Use here', exact: true }).click();
  await expect(chip).toContainText('1 still unplanned');
  await popup.getByLabel('Use in activity').selectOption('salad-tue');
  await popup.getByLabel('Amount to assign').fill('1');
  await popup.getByRole('button', { name: 'Use here', exact: true }).click();
  await expect(chip).toContainText('All planned');
  await expect(page.locator('.raw-use-badge')).toHaveCount(0);
  await expect(page.getByTestId('activity-cook-curry')).toHaveClass(/related/);
  await expect(page.getByTestId('activity-salad-tue')).toHaveClass(/related/);
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(chip).not.toHaveClass(/selected/);
  await expect(page.locator('.raw-use-badge')).toHaveCount(0);
  await expect(page.getByTestId('activity-cook-curry')).not.toHaveClass(/related/);
});

test('creates a linked meal by choosing food and clicking a time', async ({ page }) => {
  await page
    .getByTestId('activity-cook-grains')
    .getByRole('button', { name: 'Edit Cook grains and eat' })
    .click();
  await page.getByRole('button', { name: 'Plan a meal from this', exact: true }).click();
  await expect(page.locator('.placement-banner')).toContainText('Grain bowls');
  // Saturday lunch is beyond the narrow phone viewport; horizontal scroll reveals it.
  await page.locator('.calendar-scroll').evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await scrollTime(page, 11);
  const point = await timePoint(page, 5, 12 * 60);
  await page.mouse.click(point.x, point.y);
  const meal = page.locator('.time-card').filter({ hasText: 'Grain bowls meal' });
  await expect(meal).toBeVisible();
  await expect(meal).toContainText('2');
  await expect(page.locator('.placement-banner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(meal).toHaveCount(0);
});

test('moves with compact controls and preserves links while flagging blocked time', async ({
  page
}) => {
  const tuesday = await page.locator('[data-time-day]').nth(1).getAttribute('data-time-day');
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' })
    .click();
  const popup = page.getByRole('dialog', { name: 'Activity', exact: true });
  await popup.locator('.move-details summary').click();
  await popup.getByLabel('Activity date').fill(tuesday!);
  await popup.getByLabel('Activity time').fill('18:30');
  await popup.getByLabel('Activity time').press('Tab');
  await expect(popup.locator('[data-warning-code="BLOCKED_TIME"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByTestId('activity-cook-curry')).toHaveClass(/has-warning/);
  await expect(page.getByTestId('activity-cook-curry')).toContainText('4 Coconut curry');
  await expectCurryLinks(page);
});

test('renders a named blocker from a clicked time without an availability form', async ({
  page
}) => {
  await scrollTime(page, 14);
  const point = await timePoint(page, 0, 16 * 60);
  await page.mouse.click(point.x, point.y);
  const quick = page.getByRole('dialog', { name: 'Quick add', exact: true });
  await quick.getByRole('button', { name: 'Block', exact: true }).click();
  await quick.getByLabel('Activity name').fill('Visit friends');
  await quick.getByLabel('Activity name').press('Enter');
  const blocker = page.locator('.time-block').filter({ hasText: 'Visit friends' });
  await expect(blocker).toContainText('16:00 - 16:45');
  await blocker.getByRole('button', { name: 'Edit blocker Visit friends' }).click();
  const popup = page.getByRole('dialog', { name: 'Blocked time', exact: true });
  await popup.getByLabel('Blocked minutes').fill('180');
  await popup.getByLabel('Blocked minutes').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(blocker).toContainText('16:00 - 19:00');
});

test('keeps cooked leftovers distinct from ingredients', async ({ page }) => {
  await openTray(page);
  await page.getByLabel('Add cooked food').fill('2 curry');
  await page.getByLabel('Add cooked food').press('Enter');
  const stock = page.locator('[data-food-id^="stock-"]').last();
  await expect(stock).toContainText('2 unplanned');
  await stock.click();
  const popup = page.getByRole('dialog', { name: 'Prepared food', exact: true });
  await popup.getByLabel('Use in activity').selectOption('bread-mon');
  await popup.getByRole('button', { name: 'Use here', exact: true }).click();
  await expect(stock).toContainText('0 unplanned');
  await expect(page.locator('[data-activity-id]')).toHaveCount(13);
});

test('extends the timeline and retains allocations outside its visible dates', async ({ page }) => {
  const monday = await page.locator('[data-time-day]').first().getAttribute('data-time-day');
  await page.getByRole('button', { name: 'Earlier day' }).click();
  await expect(page.locator('[data-time-day]')).toHaveCount(8);
  await expect(page.locator('[data-time-day]').nth(1)).toHaveAttribute('data-time-day', monday!);
  await page.getByRole('button', { name: 'One more day' }).click();
  await expect(page.locator('[data-time-day]')).toHaveCount(9);
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(page.locator('[data-time-day]')).toHaveCount(7);
  await expect(page.locator('[data-time-day]').first()).toHaveAttribute('data-time-day', monday!);
  const tuesday = await page.locator('[data-time-day]').nth(1).getAttribute('data-time-day');
  await page.getByLabel('Jump to date').fill(tuesday!);
  await page
    .getByTestId('activity-lunch-tue')
    .getByRole('button', { name: 'Edit Curry lunch' })
    .click();
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('activity-lunch-tue').hover();
  const outside = page
    .getByRole('region', { name: 'Food relationships outside this range' })
    .getByRole('button', { name: /^2 Coconut curry.*From / });
  await expect(outside).toBeVisible();
  await outside.focus();
  await outside.press('Enter');
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Cook coconut curry');
  await expect(page.getByTestId('activity-cook-curry')).toContainText('4 Coconut curry');
});

test('drags an ingredient onto cooking and accounts for it without a popup', async ({
  page
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Touch uses a visible grip or the tested tap alternative.'
  );
  await scrollTime(page, 16);
  await openTray(page);
  const source = await page.getByTestId('food-ing-paprika').boundingBox();
  const target = await page.getByTestId('activity-cook-curry').boundingBox();
  if (!source || !target) throw new Error('Missing drag targets');
  await drag(page, { x: source.x + 70, y: source.y + 15 }, { x: target.x + 50, y: target.y + 12 });
  await expect(page.getByTestId('food-ing-paprika')).toContainText('All planned');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.raw-use-badge')).toHaveCount(0);
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Activity' }).getByLabel('Amount of Paprika used')
  ).toHaveValue('2');
});

test('Escape cancels a drag without applying the preview', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Keyboard cancellation of a pointer gesture.');
  await scrollTime(page, 16);
  const source = await page.getByTestId('activity-cook-curry').boundingBox();
  const destination = await timePoint(page, 1, 18 * 60 + 30);
  if (!source) throw new Error('Missing source');
  await page.mouse.move(source.x + 40, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  await expect(page.locator('.drag-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await expect(page.getByTestId('activity-cook-curry')).toContainText('19:15');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('drags cooking to another day and resizes a blocker on the grid', async ({ page }, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Compact controls provide the phone editing fallback.'
  );
  await scrollTime(page, 16);
  const source = await page.getByTestId('activity-cook-curry').boundingBox();
  const day = await page.locator('[data-time-day]').nth(1).boundingBox();
  if (!source || !day) throw new Error('Missing drag targets');
  await drag(
    page,
    { x: source.x + 40, y: source.y + 10 },
    { x: day.x + 50, y: day.y + (18 * 60 + 30) * PPM + 10 }
  );
  await expect(page.getByTestId('activity-cook-curry')).toContainText('18:30');
  await expect(page.getByTestId('activity-cook-curry')).toHaveClass(/has-warning/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const handle = await page
    .getByRole('button', { name: 'Resize end of blocker Climbing' })
    .boundingBox();
  if (!handle) throw new Error('Missing resize handle');
  await drag(
    page,
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    { x: handle.x + handle.width / 2, y: day.y + 22 * 60 * PPM }
  );
  await expect(page.getByTestId('block-block-climbing')).toContainText('18:00 - 22:00');
});

test('creates a blocker by dragging a time range', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Click-to-create fallback is exercised on phone.');
  await scrollTime(page, 14);
  const start = await timePoint(page, 0, 16 * 60),
    end = await timePoint(page, 0, 18 * 60 + 30);
  await drag(page, start, end);
  const quick = page.getByRole('dialog', { name: 'Quick add', exact: true });
  await quick.getByRole('button', { name: 'Block', exact: true }).click();
  await quick.getByLabel('Activity name').fill('A long walk');
  await quick.getByLabel('Activity name').press('Enter');
  await expect(page.locator('.time-block').filter({ hasText: 'A long walk' })).toContainText(
    '16:00 - 18:30'
  );
});

test('touch grips move a card without scrolling or opening its editor', async ({ page }, info) => {
  test.skip(
    info.project.name !== 'phone',
    'Exercises native Chromium touch events in the phone project.'
  );
  // Keep both touch endpoints inside the compact calendar below the stock shelf.
  await scrollTime(page, 18);
  await page.locator('.calendar-scroll').evaluate((element) => {
    element.scrollLeft = 0;
  });
  const card = await page.getByTestId('activity-cook-curry').boundingBox();
  const grip = await page.getByTestId('activity-cook-curry').locator('.drag-grip').boundingBox();
  const target = await page.locator('[data-time-day]').nth(1).boundingBox();
  if (!card || !grip || !target) throw new Error('Missing touch target');
  const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  const to = { x: target.x + 40, y: target.y + (18 * 60 + 30) * PPM + from.y - card.y };
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, id: 1 }]
    });
    for (let i = 1; i <= 12; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12, id: 1 }
        ]
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
  await expect(page.getByTestId('activity-cook-curry')).toContainText('18:30');
  await expect(page.getByTestId('activity-cook-curry')).toHaveClass(/has-warning/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('native touch scrolls an empty grid, taps to draft, and resizes activity and block edges', async ({
  page
}, info) => {
  test.skip(info.project.name !== 'phone', 'Native Chromium touch project.');
  await scrollTime(page, 9);
  const initialScroll = await page
    .locator('.calendar-scroll')
    .evaluate((element) => element.scrollTop);
  const point = await timePoint(page, 0, 10 * 60);
  const session = await page.context().newCDPSession(page);
  async function touch(from: { x: number; y: number }, to?: { x: number; y: number }) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, id: 1 }]
    });
    if (to)
      for (let i = 1; i <= 12; i++)
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: from.x + ((to.x - from.x) * i) / 12,
              y: from.y + ((to.y - from.y) * i) / 12,
              id: 1
            }
          ]
        });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  try {
    const scroll = page.locator('.calendar-scroll');
    await scroll.evaluate((element) => {
      element.addEventListener('scroll', () => element.setAttribute('data-scroll-state', 'moving'));
      element.addEventListener('scrollend', () =>
        element.setAttribute('data-scroll-state', 'settled')
      );
    });
    await touch(point, { x: point.x, y: point.y - 90 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(() => page.locator('.calendar-scroll').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(initialScroll);
    // A tap during native momentum scrolling only stops the fling; wait for it to finish.
    await expect(scroll).toHaveAttribute('data-scroll-state', 'settled');
    await scrollTime(page, 9);
    await touch(await timePoint(page, 0, 10 * 60));
    await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();
    await page.keyboard.press('Escape');
    await scrollTime(page, 16);
    for (const [name, expected] of [
      ['Resize start of Cook coconut curry', '19:30 - 20:05'],
      ['Resize end of blocker Climbing', '18:00 - 21:30']
    ] as const) {
      await page.getByRole('button', { name, exact: true }).scrollIntoViewIfNeeded();
      await scrollTime(page, name.includes('blocker') ? 20 : 18);
      const handle = await page.getByRole('button', { name, exact: true }).boundingBox();
      if (!handle) throw new Error(`Missing ${name}`);
      const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await touch(from, { x: from.x, y: from.y + (name.includes('blocker') ? 30 : 15) * PPM });
      await expect(
        name.includes('blocker')
          ? page.getByTestId('block-block-climbing')
          : page.getByTestId('activity-cook-curry')
      ).toContainText(expected);
    }
    await expectCurryLinks(page);
  } finally {
    await session.detach();
  }
});

test('keeps the plan intact for invalid inputs and undoing deletion', async ({ page }) => {
  const start = await page.locator('[data-time-day]').first().getAttribute('data-time-day');
  await page.getByLabel('Jump to date').fill('10000-01-01');
  await expect(page.locator('[data-time-day]').first()).toHaveAttribute('data-time-day', start!);
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' })
    .click();
  const popup = page.getByRole('dialog', { name: 'Activity', exact: true });
  await popup.getByLabel('Duration minutes').fill('9007199254740991');
  await popup.getByLabel('Duration minutes').press('Tab');
  await expect(popup.getByLabel('Duration minutes')).toHaveValue('50');
  await popup.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('activity-cook-curry')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.getByTestId('activity-cook-curry')).toContainText('4 Coconut curry');
  await expect(page.getByTestId('activity-lunch-tue')).toContainText('2');
});

test('parses only a numeric whitespace prefix and exposes no unit editor', async ({ page }) => {
  await openTray(page);
  for (const text of ['Nando sauce', '200g spinach', '2 jars beans']) {
    await page.getByLabel('Add ingredient', { exact: true }).fill(text);
    await page.getByLabel('Add ingredient', { exact: true }).press('Enter');
  }
  await expect(page.locator('[data-food-id^="ingredient-"]').last()).toContainText('2 jars beans');
  await expect(
    page.locator('[data-food-id^="ingredient-"]').filter({ hasText: '200g spinach' })
  ).toContainText('1 200g spinach');
  await page.getByLabel('Add cooked food').fill('500 g curry');
  await page.getByLabel('Add cooked food').press('Enter');
  const food = page.locator('[data-food-id^="stock-"]').last();
  await expect(food).toContainText('500 unplanned');
  await food.click();
  const popup = page.getByRole('dialog', { name: 'Prepared food', exact: true });
  await expect(popup.getByLabel('Food name', { exact: true })).toHaveValue('g curry');
  await expect(popup.getByLabel(/unit/i)).toHaveCount(0);
});

test('separates parallel foods and timings while exposing every allocation ID and amount', async ({
  page
}) => {
  const plan = createKitchenPlan(startOfWeek(todayDay()));
  plan.batches.push({
    id: 'extra-food',
    name: 'Extra food',
    quantity: 3,
    unit: '',
    source: { kind: 'activity', activityId: 'cook-curry' }
  });
  const producer = plan.activities.find((activity) => activity.id === 'cook-curry')!;
  plan.activities.find((activity) => activity.id === 'lunch-tue')!.start = {
    day: producer.start.day,
    minute: producer.start.minute + producer.elapsedMinutes - 5
  };
  // Only the extra food, eaten at the start, is too early. The other part is eaten at the end.
  plan.allocations.find((allocation) => allocation.id === 'curry-tue')!.when = 'end';
  plan.allocations.push({
    id: 'curry-tue-extra',
    batchId: 'extra-food',
    activityId: 'lunch-tue',
    quantity: 3,
    purpose: 'eat',
    when: 'start'
  });
  const document: PlanDocument = {
    schemaVersion: 2,
    revision: 0,
    updatedAt: new Date().toISOString(),
    plan
  };
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: document });
    else await route.fulfill({ json: { ...document, revision: 1 } });
  });
  await page.reload();
  await expect(page.locator('.food-connection')).toHaveCount(0);
  await page.getByTestId('activity-cook-curry').hover();
  await expect(page.locator('.food-connection')).toHaveCount(3);
  const ids = await page
    .locator('.food-connection')
    .evaluateAll((paths) =>
      paths.map((path) => JSON.parse(path.getAttribute('data-allocation-ids') ?? '[]') as string[])
    );
  expect(ids.filter((group) => group.includes('curry-tue'))).toEqual([['curry-tue']]);
  await expect(
    page.locator('.food-connection[data-allocation-ids*="curry-tue-extra"]')
  ).toHaveClass(/conflict/);
  // Congested same-day paths may omit annotations, but never allocations.
  const labels = await page.locator('.connection-label tspan').allTextContents();
  expect(labels.every((label) => ['2 Coconut curry', '3 Extra food'].includes(label))).toBe(true);
  await page.getByRole('heading', { name: 'Your plan', exact: true }).hover();
  await expect(page.locator('.food-connection')).toHaveCount(0);
  await page.getByTestId('activity-lunch-tue').hover();
  await expect(page.locator('.food-connection')).toHaveCount(2);
  await page
    .getByTestId('activity-lunch-tue')
    .getByRole('button', { name: 'Edit Curry lunch', exact: true })
    .click();
  await expect(page.getByLabel('Amount of Coconut curry used')).toHaveValue('2');
  await expect(page.getByLabel('Amount of Extra food used')).toHaveValue('3');
  await expect(page.locator('[data-allocation-id="curry-tue"]')).toContainText('Eat at end');
  await expect(page.locator('[data-allocation-id="curry-tue-extra"]')).toContainText(
    'Eat at start'
  );
});

test('click creation previews typed title and type, dismisses cleanly, and undo restores the grid', async ({
  page
}) => {
  await scrollTime(page, 9);
  const point = await timePoint(page, 0, 10 * 60);
  await page.mouse.click(point.x, point.y);
  const quick = page.getByRole('dialog', { name: 'Quick add' });
  const preview = page.locator('.drag-preview');
  await expect(preview).toContainText('10:00 - 10:45');
  await quick.getByLabel('Activity name').fill('Test supper');
  await expect(preview).toContainText('Test supper');
  await quick.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(preview).toHaveClass(/block/);
  await quick.getByRole('button', { name: 'Eat', exact: true }).click();
  await expect(preview).toHaveClass(/activity/);
  await quick.getByRole('button', { name: 'Close details' }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.time-card').filter({ hasText: 'Test supper' })).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await quick.getByLabel('Activity name').fill('Test supper');
  await quick.getByLabel('Activity name').press('Escape');
  await expect(preview).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await quick.getByLabel('Activity name').fill('Test supper');
  await quick.getByLabel('Activity name').press('Enter');
  await expect(page.locator('.time-card').filter({ hasText: 'Test supper' })).toContainText(
    '4 Test supper'
  );
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.locator('.time-card').filter({ hasText: 'Test supper' })).toHaveCount(0);
});

test('mouse range keeps its duration and typed blocker preview until committed', async ({
  page
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Mouse range selection.');
  await scrollTime(page, 9);
  const start = await timePoint(page, 0, 10 * 60);
  const end = await timePoint(page, 0, 11 * 60 + 30);
  await drag(page, start, end);
  const quick = page.getByRole('dialog', { name: 'Quick add' });
  const preview = page.locator('.drag-preview');
  await expect(preview).toContainText('10:00 - 11:30');
  await quick.getByRole('button', { name: 'Block', exact: true }).click();
  await quick.getByLabel('Activity name').fill('Long errand');
  await expect(preview).toHaveClass(/block/);
  await expect(preview).toContainText('Long errand');
  await quick.getByLabel('Activity name').press('Enter');
  await expect(page.locator('.time-block').filter({ hasText: 'Long errand' })).toContainText(
    '10:00 - 11:30'
  );
  await expect(preview).toHaveCount(0);
});

test('Escape cancels an in-progress mouse range without a subsequent click draft', async ({
  page
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Mouse range selection.');
  await scrollTime(page, 9);
  const start = await timePoint(page, 0, 10 * 60);
  const end = await timePoint(page, 0, 11 * 60);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await expect(page.locator('.drag-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1100); // Release after transient click-suppression timers expire.
  await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeDisabled();
  await page.mouse.click(start.x, start.y);
  await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();
});

test('a new pointerdown clears a cancelled drag fence when its release was missed', async ({
  page
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Synthetic lost mouse release regression.');
  await scrollTime(page, 9);
  const start = await timePoint(page, 0, 10 * 60);
  const end = await timePoint(page, 0, 11 * 60);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await expect(page.locator('.drag-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  // Simulate a new independent gesture without delivering the prior pointerup to the page.
  await page.getByRole('button', { name: 'One more day' }).evaluate((button) => {
    button.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse' })
    );
    button.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse' })
    );
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
  await expect(page.locator('[data-time-day]')).toHaveCount(8);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.mouse.move(20, 20);
  await page.mouse.up();
});

test('both edges resize activities and blockers while preserving the other edge and food graph', async ({
  page
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Mouse edge dragging.');
  await scrollTime(page, 16);
  for (const [name, direction, dy, expected] of [
    ['Resize start of Cook coconut curry', 'start', 15, '19:30 - 20:05'],
    ['Resize end of Cook coconut curry', 'end', 30, '19:30 - 20:30'],
    ['Resize start of blocker Climbing', 'start', 15, '18:15 - 21:00'],
    ['Resize end of blocker Climbing', 'end', 30, '18:15 - 21:30']
  ] as const) {
    const handle = await page.getByRole('button', { name, exact: true }).boundingBox();
    if (!handle) throw new Error(`Missing ${direction} handle`);
    const at = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await drag(page, at, { x: at.x, y: at.y + dy * PPM });
    const card = name.includes('blocker')
      ? page.getByTestId('block-block-climbing')
      : page.getByTestId('activity-cook-curry');
    await expect(card).toContainText(expected);
    await expectCurryLinks(page);
  }
});

test('outside pointer commits an onchange but cannot click through to a card or grid', async ({
  page
}) => {
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' })
    .click();
  const popup = page.getByRole('dialog', { name: 'Activity' });
  await popup.getByLabel('Duration minutes').fill('60');
  const extend = page.getByRole('button', { name: 'One more day' });
  // The phone sheet intentionally covers the footer; use an exposed header control.
  await page
    .getByRole('button', {
      name: (page.viewportSize()?.width ?? 0) < 700 ? /^Theme:/ : 'One more day',
      exact: true
    })
    .click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator('[data-time-day]')).toHaveCount(7);
  await expect(page.getByTestId('activity-cook-curry')).not.toHaveClass(/selected|related/);
  await expect(page.getByTestId('activity-cook-curry')).toContainText('19:15 - 20:15');
  await extend.click();
  await expect(page.locator('[data-time-day]')).toHaveCount(8);
  await scrollTime(page, 9);
  const point = await timePoint(page, 0, 10 * 60);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();
});

test('overlapping blockers both remain editable', async ({ page }) => {
  await scrollTime(page, 16);
  const point = await timePoint(page, 1, 16 * 60);
  await page.mouse.click(point.x, point.y);
  await page
    .getByRole('dialog', { name: 'Quick add' })
    .getByRole('button', { name: 'Block', exact: true })
    .click();
  await page.getByRole('dialog', { name: 'Quick add' }).getByLabel('Activity name').fill('Choir');
  await page.getByRole('dialog', { name: 'Quick add' }).getByLabel('Activity name').press('Enter');
  const climbing = page.getByTestId('block-block-climbing');
  const choir = page.locator('.time-block').filter({ hasText: 'Choir' });
  await choir
    .getByRole('button', { name: 'Edit blocker Choir' })
    .click({ position: { x: 20, y: 25 } });
  const editor = page.getByRole('dialog', { name: 'Blocked time' });
  await editor.locator('.move-details summary').click();
  await editor.getByLabel('Blocker time').fill('18:00');
  await editor.getByLabel('Blocker time').press('Tab');
  await editor.getByLabel('Blocked minutes').fill('120');
  await editor.getByLabel('Blocked minutes').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  const a = await climbing.boundingBox(),
    b = await choir.boundingBox();
  if (!a || !b) throw new Error('Missing blockers');
  expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
  await climbing
    .getByRole('button', { name: 'Edit blocker Climbing' })
    .click({ position: { x: 20, y: 25 } });
  await expect(
    page.getByRole('dialog', { name: 'Blocked time' }).getByLabel('Blocker name')
  ).toHaveValue('Climbing');
  await page.getByRole('button', { name: 'Close details' }).click();
  await choir
    .getByRole('button', { name: 'Edit blocker Choir' })
    .click({ position: { x: 20, y: 25 } });
  await expect(
    page.getByRole('dialog', { name: 'Blocked time' }).getByLabel('Blocker name')
  ).toHaveValue('Choir');
});
