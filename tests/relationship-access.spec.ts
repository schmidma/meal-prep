import { expect, type Page } from '@playwright/test';
import { naturalTest as test } from './fixtures';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
import { createKitchenPlan, type KitchenPlan } from '../src/lib/kitchen';
import type { PlanDocument } from '../src/lib/plan-document';

test.skip(({ isMobile }) => isMobile, 'Desktop mouse and keyboard interaction paths');

async function load(page: Page) {
  const week = startOfWeek(todayDay());
  const plan = createKitchenPlan(week);
  const cook = plan.activities.find((item) => item.id === 'cook-curry')!;
  cook.start = { day: week, minute: 810 };
  const lunch = plan.activities.find((item) => item.id === 'lunch-tue')!;
  lunch.start = { day: addDays(week, 8), minute: 750 };
  plan.activities = [cook, lunch];
  plan.batches = plan.batches.filter((item) => item.id === 'curry');
  plan.allocations = plan.allocations.filter(
    (item) => item.batchId === 'curry' && item.activityId === 'lunch-tue'
  );
  plan.blockers = [];
  plan.ingredientUses = [];
  plan.activityRequirements = [];
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
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  return {
    writes,
    source: page.getByRole('button', { name: 'Edit Cook coconut curry', exact: true }),
    strip: page.getByRole('region', { name: 'Food relationships outside this range' })
  };
}

async function geometry(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  return page.evaluate(() => {
    const scroll = document.querySelector('.calendar-scroll')!;
    return {
      rects: Array.from(
        document.querySelectorAll(
          '.home-tray, .calendar-shell, .calendar-scroll, .calendar-day-header, .time-card'
        ),
        (element) => {
          const rect = element.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height];
        }
      ),
      scroll: [scroll.scrollTop, scroll.scrollLeft, scroll.scrollWidth, scroll.scrollHeight]
    };
  });
}

test('off-range actions survive natural mouse travel and clear when leaving the calendar', async ({
  page
}) => {
  const { source, strip, writes } = await load(page);
  await source.hover();
  await expect(strip).toBeVisible();
  const before = await geometry(page);
  await page.getByRole('heading', { name: 'Your plan', exact: true }).hover();
  await expect(strip).toHaveCount(0);
  expect(await geometry(page)).toEqual(before);
  await source.hover();
  expect(await geometry(page)).toEqual(before);
  const link = strip.getByRole('button');
  await expect(link).toBeVisible();
  const bounds = (await link.boundingBox())!;
  // Real intermediate mouse positions cross empty calendar space, unlike a direct locator click.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 20 });
  await expect(link).toBeVisible();
  expect(await geometry(page)).toEqual(before);
  await page.mouse.down();
  expect(await geometry(page)).toEqual(before);
  await page.mouse.up();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Curry lunch');
  expect(writes).toHaveLength(0);
});

test('off-range actions are reachable through normal reverse Tab navigation', async ({ page }) => {
  const { source, strip, writes } = await load(page);
  // Start from the clicked view button and use normal Tab order, never programmatic focus.
  for (let i = 0; i < 20; i++) {
    if (await source.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(source).toBeFocused();
  await expect(strip).toBeVisible();
  const before = await geometry(page);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.empty-calendar').first()).toBeFocused();
  await expect(strip).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('region', { name: 'Time-based planner' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(strip.getByRole('button')).toBeFocused();
  expect(await geometry(page)).toEqual(before);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Curry lunch');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Edit Curry lunch', exact: true })).toBeFocused();
  await expect(strip).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('an off-range action survives pointerdown after dragging selects its source', async ({
  page
}) => {
  const { source, strip, writes } = await load(page);
  await source.hover();
  await expect(strip).toBeVisible();
  const bounds = (await page
    .locator('[data-activity-id="cook-curry"] .card-drag-grip')
    .boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 150, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await expect(source).toHaveAttribute('aria-pressed', 'true');
  expect(writes).toHaveLength(1);
  const link = strip.getByRole('button');
  const target = (await link.boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.down();
  await expect(link).toBeVisible();
  // Pointerdown on the overlay must not clear the selected-after-drag source.
  await expect(source).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Curry lunch');
  expect(writes).toHaveLength(1);
});
