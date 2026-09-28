import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { createKitchenPlan } from '../src/lib/kitchen';
import { startOfWeek, todayDay } from '../src/lib/calendar';
import type { PlanDocument } from '../src/lib/plan-document';

async function openTray(page: Page) {
  const tray = page.locator('.home-tray');
  await expect(tray).toBeVisible();
}

// The fixture supplies in-memory HTTP responses; override just this test's GET with
// a raw ingredient linked to a producer and its downstream meals.
for (const scheme of ['light', 'dark'] as const) {
  test(`hover previews only direct food relationships without saving or dimming (${scheme})`, async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const plan = createKitchenPlan(startOfWeek(todayDay()));
    plan.ingredientUses.push({
      id: 'paprika-curry',
      ingredientId: 'ing-paprika',
      activityId: 'cook-curry',
      quantity: 1
    });
    const lunch = plan.activities.find((item) => item.id === 'lunch-tue')!;
    plan.blockers[0].start = { ...lunch.start };
    const document: PlanDocument = {
      schemaVersion: 2,
      revision: 0,
      updatedAt: new Date().toISOString(),
      plan
    };
    await page.route('**/api/plan', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill({ json: document });
      else throw new Error('Hover or selection unexpectedly saved the plan');
    });
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/plan') && request.method() !== 'GET')
        writes.push(request.method());
    });
    await page.goto('/');
    await openTray(page);
    const paprika = page.getByTestId('food-ing-paprika');
    const curry = page.getByTestId('activity-cook-curry');
    const lunchCard = page.getByTestId('activity-lunch-tue');
    const unrelated = page.getByTestId('activity-dinner-thu');
    const unrelatedFood = page.getByTestId('food-ing-spinach');
    const connection = page.locator('.food-connection[data-allocation-ids*="curry-tue"]');
    const otherConnection = page.locator('.food-connection[data-allocation-ids*="grains-thu"]');
    const label = page
      .locator('.connection-label')
      .filter({ has: page.locator('[data-allocation-id="curry-tue"]') });
    await page.getByRole('heading', { name: 'Your plan', exact: true }).hover();
    await expect(page.locator('.calendar-connections path')).toHaveCount(0);
    await expect(lunchCard).toHaveClass(/has-warning/);
    const warningBorder = await lunchCard.evaluate(
      (element) => getComputedStyle(element).borderColor
    );
    await paprika.hover();
    await expect(paprika).toHaveClass(/related/);
    await expect(curry).toHaveClass(/related/);
    await expect(lunchCard).not.toHaveClass(/related/);
    await expect(page.locator('.food-connection')).toHaveCount(0);
    await expect(otherConnection).toHaveCount(0);
    await expect(unrelated).not.toHaveClass(/related|selected/);
    await expect(unrelatedFood).not.toHaveClass(/related|selected/);
    expect(await lunchCard.evaluate((element) => getComputedStyle(element).borderColor)).toBe(
      warningBorder
    );
    await expect(page.locator('.raw-use-badge')).toHaveCount(0);
    await page.getByRole('heading', { name: 'Your plan', exact: true }).hover();
    await expect(curry).not.toHaveClass(/related/);
    await expect(connection).toHaveCount(0);
    await expect(label).toHaveCount(0);
    await expect(page.locator('.raw-use-badge')).toHaveCount(0);
    await lunchCard.hover();
    await expect(paprika).not.toHaveClass(/related/);
    await expect(curry).toHaveClass(/related/);
    await expect(connection).toHaveClass(/emphasized/);
    // The tiny phone viewport may have no safe annotation space; food stays named on the card.
    await expect(lunchCard.locator('.time-card-food')).toContainText('curry');
    await expect(page.locator('.food-connection')).toHaveCount(1);
    await expect(page.getByTestId('activity-lunch-wed')).not.toHaveClass(/related/);
    await expect(unrelated).not.toHaveClass(/related/);
    expect(await unrelated.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    const prepared = page.getByTestId('food-stock-veg');
    await prepared.hover();
    await expect(page.getByTestId('activity-lunch-mon')).toHaveClass(/related/);
    await expect(page.getByTestId('activity-salad-tue')).toHaveClass(/related/);
    await expect(curry).not.toHaveClass(/related/);
    await page.getByTestId('activity-lunch-mon').hover();
    await expect(prepared).toHaveClass(/related/);
    expect(writes).toEqual([]);
  });

  test(`dismissal removes selection without restoring stale hover (${scheme})`, async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const curry = page.getByTestId('activity-cook-curry');
    const lunch = page.getByTestId('activity-lunch-tue');
    const idleShadow = await curry.evaluate((element) => getComputedStyle(element).boxShadow);
    await curry.getByRole('button', { name: 'Edit Cook coconut curry' }).click();
    await expect(curry).toHaveClass(/selected/);
    await expect(lunch).toHaveClass(/related/);
    await page.getByRole('heading', { name: 'Your plan', exact: true }).hover();
    await expect(lunch).toHaveClass(/related/); // Selection outlives pointer hover.
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(curry).not.toHaveClass(/selected|related/);
    await expect(lunch).not.toHaveClass(/related/);
    expect(await curry.evaluate((element) => getComputedStyle(element).boxShadow)).toBe(idleShadow);
    await curry.getByRole('button', { name: 'Edit Cook coconut curry' }).click();
    await page
      .getByRole('button', {
        name: (page.viewportSize()?.width ?? 0) < 700 ? /^Theme:/ : 'One more day',
        exact: true
      })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(curry).not.toHaveClass(/selected|related/);
    await expect(page.locator('[data-time-day]')).toHaveCount(7); // Outside click was consumed.
    await curry.getByRole('button', { name: 'Edit Cook coconut curry' }).click();
    // Keep the pointer at the card's position, even if the phone sheet covers it.
    const bounds = await curry.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(curry).not.toHaveClass(/selected|related/);
    await expect(lunch).not.toHaveClass(/related/);
    await curry.evaluate((element) =>
      element.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })
      )
    );
    await expect(curry).not.toHaveClass(/related/); // Untrusted/synthetic movement is not hover.
    await page.getByRole('heading', { name: 'Your plan', exact: true }).hover();
    await expect(curry).not.toHaveClass(/selected|related/);
    // A genuine new movement can preview again, without making a persistent selection.
    await curry.hover();
    await expect(lunch).toHaveClass(/related/);
    await expect(curry).not.toHaveClass(/selected/);
  });
}

test('keyboard and touch selection clear cleanly; a no-editor selection can be dismissed', async ({
  page
}, info) => {
  await page.goto('/');
  const curry = page.getByTestId('activity-cook-curry');
  const button = curry.getByRole('button', { name: 'Edit Cook coconut curry' });
  if (info.project.name === 'phone') await button.tap();
  else {
    await button.focus();
    await button.press('Enter');
  }
  await expect(curry).toHaveClass(/selected/);
  await page.keyboard.press('Escape');
  await expect(curry).not.toHaveClass(/selected|related/);
  await expect(page.getByTestId('activity-lunch-tue')).not.toHaveClass(/related/);
  if (info.project.name === 'phone') return;
  // Quick creation provides success feedback without leaving an editor open.
  await page.locator('.calendar-scroll').evaluate((element) => (element.scrollTop = 9 * 75));
  const day = await page.locator('[data-time-day]').first().boundingBox();
  if (!day) throw new Error('Missing calendar day');
  await page.mouse.click(day.x + day.width / 2, day.y + 10 * 60 * 1.25 + 4);
  const quick = page.getByRole('dialog', { name: 'Quick add' });
  await quick.getByLabel('Activity name').fill('Fresh soup');
  await quick.getByLabel('Activity name').press('Enter');
  const soup = page.locator('.time-card').filter({ hasText: 'Fresh soup' });
  await expect(soup).toHaveClass(/selected/);
  await page.getByRole('heading', { name: 'Your plan', exact: true }).click();
  await expect(soup).not.toHaveClass(/selected|related/);
});
