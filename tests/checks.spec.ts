import { test, expect, type Page, type Locator } from '@playwright/test';
import { startOfWeek, todayDay, addDays } from '../src/lib/calendar';
import { type KitchenPlan } from '../src/lib/kitchen';
import { checkTime } from '../src/lib/plan-checks';
import { type Activity } from '../src/lib/domain';
import { type PlanDocument } from '../src/lib/plan-document';

const day = startOfWeek(todayDay());
const activity = (id: string, minute: number, title = 'Lunch', offset = 0): Activity => ({
  id,
  title,
  start: { day: addDays(day, offset), minute },
  kind: 'meal',
  elapsedMinutes: 30,
  handsOnMinutes: 0,
  requiresHome: false,
  notes: ''
});
function fixture(stress = false): KitchenPlan {
  const meals = stress
    ? Array.from({ length: 18 }, (_, index) => activity(`meal-${index}`, 600, 'Lunch', index))
    : [activity('meal-0', 600)];
  return {
    activities: meals,
    batches: [
      {
        id: 'bread',
        name: 'Bread',
        quantity: 10,
        unit: '',
        source: {
          kind: 'existing',
          availableAt: { day: addDays(day, stress ? 20 : 0), minute: 630 }
        }
      }
    ],
    allocations: meals.map((meal, index) => ({
      id: `use-${index}`,
      batchId: 'bread',
      activityId: meal.id,
      quantity: 0.25,
      purpose: 'eat',
      when: 'start'
    })),
    ingredients: [{ id: 'carrots', name: 'Carrots', quantity: 4, unit: '' }],
    ingredientUses: [{ id: 'raw-use', ingredientId: 'carrots', activityId: 'meal-0', quantity: 5 }],
    blockers: [],
    recipes: [
      {
        id: 'recipe',
        name: 'Soup',
        yieldQuantity: 4,
        durationMinutes: 45,
        ingredients: [],
        instructions: ''
      }
    ],
    activityRequirements: [],
    availability: {}
  };
}
async function load(page: Page, plan = fixture()) {
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
  return { writes, saved: () => document.plan };
}
const heading = (page: Page) => page.locator('.heading-actions');
const dialog = (page: Page) => page.getByRole('dialog');
const checks = (page: Page) => heading(page).getByRole('button', { name: /^Checks / });
const recipes = (page: Page) => heading(page).getByRole('button', { name: 'Recipes', exact: true });
const click = (locator: Locator, mobile: boolean) => (mobile ? locator.tap() : locator.click());

test('one activation switches destinations, preserves recipe drafts and commits a pending edit once', async ({
  page,
  isMobile
}) => {
  const { writes, saved } = await load(page);
  await click(recipes(page), isMobile);
  await page.getByLabel('New recipe name').fill('Unsubmitted pie');
  await click(checks(page), isMobile);
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Things to check');
  await click(recipes(page), isMobile);
  await expect(page.getByLabel('New recipe name')).toHaveValue('Unsubmitted pie');
  await dialog(page)
    .getByRole('button', { name: /Soup Makes/ })
    .click();
  await page.getByLabel('Recipe name', { exact: true }).fill('Renamed soup');
  await click(checks(page), isMobile);
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Things to check');
  await expect.poll(() => writes.length).toBe(1);
  expect(saved().recipes[0].name).toBe('Renamed soup');
  await click(recipes(page), isMobile);
  await expect(page.getByLabel('Recipe name', { exact: true })).toHaveValue('Renamed soup');
  await click(recipes(page), isMobile); // No reset when already here.
  await expect(page.getByLabel('Recipe name', { exact: true })).toHaveValue('Renamed soup');
  await dialog(page).getByRole('button', { name: 'All recipes', exact: true }).click();
  await expect(page.getByLabel('New recipe name')).toHaveValue('Unsubmitted pie');
  expect(writes).toHaveLength(1);
});

test('shared header provides a short normal keyboard route in both directions', async ({
  page,
  isMobile
}) => {
  const { writes } = await load(page);
  await checks(page).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('button', { name: /^Checks / })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('button', { name: 'Recipes', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Recipes');
  // Existing recipes start at the library heading; header destinations remain nearby.
  for (let i = 0; i < 7; i++) {
    if (
      await dialog(page)
        .getByRole('button', { name: /^Checks / })
        .evaluate((node) => node === document.activeElement)
    )
      break;
    await page.keyboard.press(isMobile ? 'Tab' : 'Shift+Tab');
  }
  await expect(dialog(page).getByRole('button', { name: /^Checks / })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Things to check');
  await page.keyboard.press('Escape');
  await expect(checks(page)).toBeFocused();
  expect(writes).toHaveLength(0);
});

test('ordinary outside gesture commits but cannot activate another control or create on canvas', async ({
  page,
  isMobile
}) => {
  const { writes } = await load(page);
  await recipes(page).click();
  await dialog(page)
    .getByRole('button', { name: /Soup Makes/ })
    .click();
  await page.getByLabel('Recipe name', { exact: true }).fill('Outside commit');
  const theme = page.getByRole('button', { name: /^Theme:/ });
  const choice = await theme.getAttribute('data-theme-choice');
  await click(theme, isMobile);
  await expect(dialog(page)).toHaveCount(0);
  await expect(theme).toHaveAttribute('data-theme-choice', choice!);
  await expect.poll(() => writes.length).toBe(1);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await checks(page).click();
  const point = await page.locator('.empty-calendar').first().boundingBox();
  expect(point).not.toBeNull();
  const scroll = await page.locator('.calendar-scroll').boundingBox();
  await page.mouse.click(point!.x + 20, scroll!.y + 90);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

test('zero checks remain available and navigation does not write', async ({ page, isMobile }) => {
  const plan = fixture();
  plan.ingredientUses = [];
  plan.allocations = [];
  const { writes } = await load(page, plan);
  await expect(checks(page)).toHaveText('Checks All clear');
  await click(checks(page), isMobile);
  await expect(dialog(page)).toContainText('No quantity or timing checks');
  await expect(dialog(page)).toContainText('Across your whole plan, not just this week');
  await click(dialog(page).getByRole('button', { name: 'Recipes', exact: true }), isMobile);
  await click(dialog(page).getByRole('button', { name: /^Checks / }), isMobile);
  expect(writes).toHaveLength(0);
});

test('quantity check resolves through an edit and Back keeps clear orientation and live count', async ({
  page,
  isMobile
}) => {
  const { writes } = await load(page);
  await click(checks(page), isMobile);
  const card = dialog(page).locator('[data-warning-code="OVER_ALLOCATED_INGREDIENT"]');
  await expect(card).toContainText('Carrots: 1 short');
  await expect(card.locator('dd')).toHaveText(['4', '5', '1']);
  await click(card.getByRole('button', { name: 'Review quantity & assignments' }), isMobile);
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Ingredient');
  await page.getByLabel('Amount at home').fill('5');
  await click(dialog(page).getByRole('button', { name: 'Back to checks' }), isMobile);
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Things to check');
  await expect(dialog(page).getByRole('status')).toHaveText('Resolved: Carrots: 1 short');
  await expect(dialog(page).getByRole('button', { name: 'Review food readiness' })).toBeFocused();
  await expect(dialog(page).getByRole('button', { name: 'Review food readiness' })).toBeInViewport({
    ratio: 1
  });
  await expect(checks(page)).toHaveText('Checks 1');
  await expect.poll(() => writes.length).toBe(1);
});

test('same-name dated readiness rows retain scroll, focus and context through entity navigation', async ({
  page,
  isMobile
}) => {
  const { writes } = await load(page, fixture(true));
  await click(checks(page), isMobile);
  await expect(dialog(page)).toContainText('19 checks in 2 cards');
  const card = dialog(page).locator('[data-warning-code="BEFORE_READY"]');
  await expect(card.locator('li')).toHaveCount(18);
  const namedActions = card.getByRole('button', { name: /^Review meal timing:/ });
  await expect(namedActions.first()).toHaveAttribute(
    'aria-label',
    `Review meal timing: Lunch, needed ${checkTime({ day, minute: 600 })}`
  );
  await expect(namedActions.nth(1)).toHaveAttribute(
    'aria-label',
    `Review meal timing: Lunch, needed ${checkTime({ day: addDays(day, 1), minute: 600 })}`
  );
  expect(await namedActions.first().getAttribute('aria-label')).not.toBe(
    await namedActions.nth(1).getAttribute('aria-label')
  );
  const action = namedActions.nth(14);
  await action.scrollIntoViewIfNeeded();
  const offset = await action.evaluate(
    (node) =>
      node.getBoundingClientRect().top -
      node.closest('.inspector-body')!.getBoundingClientRect().top
  );
  await click(action, isMobile);
  await expect(page.getByLabel('Activity date')).toHaveValue(addDays(day, 14));
  await expect(page.getByLabel('Activity time')).toBeVisible();
  await expect(page.getByLabel('Activity time')).toBeFocused();
  await expect(page.getByLabel('Jump to date')).toHaveValue(addDays(day, 14));
  await dialog(page).getByRole('button', { name: 'Bread', exact: true }).click();
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Prepared food');
  await click(dialog(page).getByRole('button', { name: 'Back to checks' }), isMobile);
  await expect(action).toBeFocused();
  await expect
    .poll(async () =>
      Math.abs(
        (await action.evaluate(
          (node) =>
            node.getBoundingClientRect().top -
            node.closest('.inspector-body')!.getBoundingClientRect().top
        )) - offset
      )
    )
    .toBeLessThanOrEqual(1);
  await expect(action).toBeInViewport({ ratio: 1 });
  const bounds = await action.boundingBox();
  const body = await dialog(page).locator('.inspector-body').boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(body!.y);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(body!.y + body!.height);
  expect(writes).toHaveLength(0);
});

test('checks navigation preserves pending assignment and meal placement without writing', async ({
  page
}) => {
  const { writes } = await load(page);
  await checks(page).click();
  await dialog(page).getByRole('button', { name: 'Review quantity & assignments' }).click();
  await page.getByLabel('Amount to assign').fill('1');
  await dialog(page).getByRole('button', { name: 'Choose on calendar' }).click();
  await expect(page.locator('.placement-banner')).toContainText('Choose an activity for 1 Carrots');
  await checks(page).click();
  await dialog(page)
    .getByRole('button', { name: /^Review meal timing:/ })
    .click();
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('Lunch');
  await expect(page.locator('.placement-banner')).toContainText('Choose an activity for 1 Carrots');
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  await dialog(page).getByRole('button', { name: 'Close details' }).click();
  await page
    .locator('.placement-banner')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await checks(page).click();
  await dialog(page).getByRole('button', { name: 'Review food readiness' }).click();
  await dialog(page).getByRole('button', { name: 'Plan a new meal from this' }).click();
  await checks(page).click();
  await dialog(page)
    .getByRole('button', { name: /^Review meal timing:/ })
    .click();
  await expect(page.locator('.placement-banner')).toContainText('to use Bread');
  await dialog(page).getByRole('button', { name: 'Back to checks' }).click();
  await expect(page.locator('.placement-banner')).toContainText('to use Bread');
  expect(writes).toHaveLength(0);
});

test('expanded phone details are shared across destinations and reset on desktop resize', async ({
  page
}) => {
  const { writes } = await load(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await checks(page).click();
  const initial = (await dialog(page).boundingBox())!;
  await dialog(page).getByRole('button', { name: 'Expand details' }).click();
  await expect.poll(async () => (await dialog(page).boundingBox())!.height).toBe(820);
  await dialog(page).getByRole('button', { name: 'Recipes', exact: true }).click();
  expect((await dialog(page).boundingBox())!.height).toBe(820);
  await dialog(page).getByRole('button', { name: 'Reduce details' }).click();
  expect((await dialog(page).boundingBox())!.height).toBe(initial.height);
  await dialog(page).getByRole('button', { name: 'Expand details' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(dialog(page)).toHaveCSS('max-height', 'none');
  await expect
    .poll(async () => {
      const box = (await dialog(page).boundingBox())!;
      return Math.round(box.y + box.height);
    })
    .toBe(986);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog(page).getByRole('button', { name: 'Expand details' })).toBeVisible();
  await expect.poll(async () => (await dialog(page).boundingBox())!.height).toBe(initial.height);
  expect(writes).toHaveLength(0);
});
