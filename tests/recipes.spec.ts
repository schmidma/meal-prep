import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { MIN_CARD_HEIGHT } from '../src/lib/time-layout';
import type { KitchenPlan } from '../src/lib/kitchen';
import { textContrast } from './contrast';

async function savedPlan(page: Page): Promise<KitchenPlan> {
  // Browser fetch is intercepted by the per-page fixture, unlike page.request.
  return page.evaluate(async () => (await (await fetch('/api/plan')).json()).plan);
}

async function library(page: Page) {
  await page
    .locator('.heading-actions')
    .getByRole('button', { name: 'Recipes', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Recipes' });
}
async function addRecipe(page: Page, name = 'Bean stew') {
  const popup = await library(page);
  await popup.getByLabel('New recipe name').fill(name);
  await popup.getByRole('button', { name: 'Add recipe' }).click();
  await expect(popup.getByLabel('Recipe name')).toHaveValue(name);
  return popup;
}
async function quickAt(page: Page, minute = 600, dayIndex = 0) {
  await page
    .locator('.calendar-scroll')
    .evaluate((element, top) => (element.scrollTop = top), (minute - 60) * 1.25);
  await page
    .locator('[data-time-day]')
    .nth(dayIndex)
    .evaluate((element) => {
      const scroll = element.closest('.calendar-scroll')!;
      scroll.scrollLeft = (element as HTMLElement).offsetLeft - 52;
    });
  const rect = await page.locator('[data-time-day]').nth(dayIndex).boundingBox();
  if (!rect) throw new Error('Calendar day missing');
  await page.mouse.click(rect.x + rect.width * 0.5, rect.y + minute * 1.25 + 4);
  return page.getByRole('dialog', { name: 'Quick add' });
}
async function selectRecipe(quick: ReturnType<Page['getByRole']>, name = 'Bean stew') {
  const input = quick.getByRole('combobox', { name: 'Activity name' });
  await input.fill(name);
  await quick.getByRole('option', { name, exact: true }).click();
  await expect(input).toHaveValue(name);
  await expect(quick.getByText(`Recipe: ${name}`)).toBeVisible();
}
async function addPlaced(page: Page, name: string, yieldQuantity: string) {
  const quick = await quickAt(page, 900);
  await selectRecipe(quick);
  await expect(quick.getByLabel('Activity name')).toHaveValue('Bean stew');
  await quick.getByLabel('Activity name').fill(name);
  await quick.getByLabel('Make quantity').fill(yieldQuantity);
  await quick.getByRole('button', { name: 'Add to plan' }).click();
  await expect(quick).toHaveCount(0);
  return page.locator('.time-card').filter({ hasText: name });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.locator('.heading-actions').getByRole('button', { name: 'Recipes', exact: true })
  ).toBeEnabled();
});

test('manual text including an exact recipe name stays unbound; suggestions filter without silently truncating', async ({
  page
}) => {
  const popup = await addRecipe(page);
  await popup.getByLabel('Recipe yield').fill('6');
  await popup.getByLabel('Recipe yield').press('Tab');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).fill('3 carrots');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Close details' }).click();
  const quick = await quickAt(page);
  const name = quick.getByRole('combobox', { name: 'Activity name' });
  await expect(name).toHaveAttribute('aria-autocomplete', 'list');
  await expect(name).toHaveAttribute('aria-expanded', 'true');
  await expect(quick.getByRole('option', { name: 'Bean stew' })).toBeVisible();
  await name.fill('beAN');
  await expect(quick.getByRole('option', { name: 'Bean stew' })).toBeVisible();
  await name.fill('unrelated');
  await expect(quick.getByRole('option')).toHaveCount(0);
  await name.fill('Bean stew');
  await expect(quick.getByLabel('Make quantity')).toHaveCount(0);
  await quick.getByRole('button', { name: 'Add to plan' }).click();
  const plan = await savedPlan(page);
  const activity = plan.activities.find((a) => a.title === 'Bean stew');
  expect(activity?.elapsedMinutes).toBe(45);
  expect(
    plan.batches.find(
      (batch) => batch.source.kind === 'activity' && batch.source.activityId === activity?.id
    )?.quantity
  ).toBe(4);
  expect(
    plan.activityRequirements.some((requirement) => requirement.activityId === activity?.id)
  ).toBe(false);
});

test('keyboard acceptance does not submit; Escape closes suggestions then quick add', async ({
  page
}) => {
  for (const recipeName of ['Bean stew', 'Beet roast', 'Berry crumble']) {
    await addRecipe(page, recipeName);
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  const quick = await quickAt(page);
  const name = quick.getByRole('combobox', { name: 'Activity name' });
  await name.fill('be');
  await name.press('Home');
  expect(await name.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(0);
  await name.press('End');
  expect(await name.evaluate((element) => (element as HTMLInputElement).selectionStart)).toBe(2);
  await name.press('ArrowUp');
  await expect(name).toHaveAttribute('aria-activedescendant', /.+-2$/);
  await name.fill('b');
  await expect(name).not.toHaveAttribute('aria-activedescendant');
  await name.press('ArrowDown');
  await expect(name).toHaveAttribute('aria-activedescendant', /.+-0$/);
  await expect(quick.getByRole('option', { name: 'Bean stew' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await name.press('Enter');
  await expect(quick).toBeVisible();
  await expect(quick.getByText('Recipe: Bean stew')).toBeVisible();
  await name.fill('Renamed stew');
  await expect(quick.getByText('Recipe: Bean stew')).toBeVisible();
  await name.press('Escape');
  await expect(quick).toBeVisible();
  await expect(name).toHaveAttribute('aria-expanded', 'false');
  await name.press('Escape');
  await expect(quick).toHaveCount(0);
  expect((await savedPlan(page)).activities.some((a) => a.title === 'Renamed stew')).toBe(false);
  const next = await quickAt(page, 900);
  const nextName = next.getByRole('combobox', { name: 'Activity name' });
  await nextName.fill('be');
  await nextName.press('Escape');
  await expect(nextName).toHaveAttribute('aria-expanded', 'false');
  await nextName.press('ArrowDown');
  await expect(nextName).toHaveAttribute('aria-expanded', 'true');
  await expect(nextName).toHaveAttribute('aria-activedescendant', /.+-0$/);
  await nextName.press('Enter');
  await expect(next).toBeVisible();
  await nextName.press('Enter');
  await expect(next).toHaveCount(0);
  await expect(page.locator('.time-card').filter({ hasText: 'Bean stew' })).toBeVisible();
});

test('remove recipe preserves title and resets duration; switching recipe replaces yield', async ({
  page
}) => {
  const popup = await addRecipe(page);
  await popup.getByLabel('Recipe duration minutes').fill('90');
  await popup.getByLabel('Recipe duration minutes').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  const quick = await quickAt(page);
  await selectRecipe(quick);
  const name = quick.getByRole('combobox', { name: 'Activity name' });
  await name.fill('My supper');
  await quick.getByLabel('Make quantity').fill('0');
  await quick.getByRole('button', { name: 'Add to plan' }).click();
  await expect(quick).toBeVisible();
  await quick.getByLabel('Make quantity').fill('3');
  await quick.getByRole('button', { name: 'Remove recipe' }).click();
  await expect(name).toHaveValue('My supper');
  await expect(quick.getByLabel('Make quantity')).toHaveCount(0);
  await expect(quick.getByText('45 minutes. Adjust on the card.')).toBeVisible();
  await selectRecipe(quick);
  await expect(quick.getByLabel('Make quantity')).toHaveValue('4');
  await name.fill('Final supper');
  await name.press('Enter');
  await expect(page.locator('.time-card').filter({ hasText: 'Final supper' })).toBeVisible();
});

test('all matching options remain scrollable and pointer or touch picks the intended recipe', async ({
  page
}, info) => {
  const popup = await library(page);
  for (let i = 0; i < 12; i++) {
    await popup.getByLabel('New recipe name').fill(`Soup ${i}`);
    await popup.getByRole('button', { name: 'Add recipe' }).click();
    if (i < 11) await popup.getByRole('button', { name: 'All recipes' }).click();
  }
  await page.getByRole('button', { name: 'Close details' }).click();
  const quick = await quickAt(page);
  const name = quick.getByRole('combobox', { name: 'Activity name' });
  await name.fill('sOuP');
  await expect(quick.getByRole('option')).toHaveCount(12);
  const list = quick.getByRole('listbox', { name: 'Recipes' });
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const last = quick.getByRole('option', { name: 'Soup 11' });
  if (info.project.name === 'phone') {
    const rect = await list.boundingBox();
    if (!rect) throw new Error('Recipe suggestions missing');
    const client = await page.context().newCDPSession(page);
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height - 20;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let offset = 20; offset <= 100; offset += 20)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - offset }]
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(quick.getByRole('option')).toHaveCount(12);
    await last.tap();
  } else await last.click();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Soup 11');
  await expect(quick.getByText('Recipe: Soup 11')).toBeVisible();
});

test('focused Name preserves click and long-press activation geometry for Eat and Add', async ({
  page
}, info) => {
  await addRecipe(page, 'Chickpea curry');
  await page.getByRole('button', { name: 'Close details' }).click();
  const quick = await quickAt(page);
  const name = quick.getByRole('combobox', { name: 'Activity name' });
  await name.fill('Chickpea curry');
  const eat = quick.getByRole('button', { name: 'Eat', exact: true });
  if (info.project.name === 'phone') await eat.tap();
  else await eat.click();
  await expect(quick).toBeVisible();
  await expect(eat).toHaveClass(/active/);
  await quick.getByRole('button', { name: 'Cook', exact: true }).click();
  await name.fill('Chickpea curry');
  const add = quick.getByRole('button', { name: 'Add to plan' });
  const before = await add.boundingBox();
  if (!before) throw new Error('Add button missing');
  const point = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  const session = info.project.name === 'phone' ? await page.context().newCDPSession(page) : null;
  if (session)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
  }
  await page.waitForTimeout(750); // Deliberately hold beyond any short blur-delay workaround.
  expect(await add.boundingBox()).toEqual(before);
  if (session) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else await page.mouse.up();
  await expect(quick).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const plan = await savedPlan(page);
  const activity = plan.activities.find((item) => item.title === 'Chickpea curry')!;
  expect(activity).toBeDefined();
  expect(plan.activityRequirements.filter((item) => item.activityId === activity.id)).toEqual([]);
});

test('reopened ArrowUp reveals the last mounted option without scrolling the page; modified arrows stay native', async ({
  page
}) => {
  for (let index = 0; index < 8; index++) {
    await addRecipe(page, `Soup ${index}`);
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  const quick = await quickAt(page);
  const name = quick.getByRole('combobox', { name: 'Activity name' });
  await name.fill('Soup');
  await name.evaluate((element) => (element as HTMLInputElement).setSelectionRange(4, 4));
  await name.press('Shift+ArrowUp');
  expect(
    await name.evaluate((element) => [
      (element as HTMLInputElement).selectionStart,
      (element as HTMLInputElement).selectionEnd
    ])
  ).toEqual([0, 4]);
  await expect(name).not.toHaveAttribute('aria-activedescendant');
  await name.press('Escape');
  const scrollBefore = await page.evaluate(() => [
    window.scrollY,
    document.querySelector('.calendar-scroll')!.scrollTop
  ]);
  await name.press('ArrowUp');
  const last = quick.getByRole('option', { name: 'Soup 7', exact: true });
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(async () =>
      last.evaluate((element) => {
        const rect = element.getBoundingClientRect(),
          list = element.parentElement!.getBoundingClientRect();
        return rect.top >= list.top && rect.bottom <= list.bottom;
      })
    )
    .toBe(true);
  expect(
    await page.evaluate(() => [
      window.scrollY,
      document.querySelector('.calendar-scroll')!.scrollTop
    ])
  ).toEqual(scrollBefore);
  await expect(last).toContainText('Makes 4 / 45 min');
  await name.press('Tab');
  await expect(quick.getByRole('listbox')).toHaveCount(0);
  await expect(quick.getByLabel('Make quantity')).toHaveCount(0);
});

test('composition Enter never selects a suggestion or submits', async ({ page }) => {
  await addRecipe(page);
  await page.getByRole('button', { name: 'Close details' }).click();
  const quick = await quickAt(page);
  const name = quick.getByRole('combobox', { name: 'Activity name' });
  await name.fill('be');
  await name.press('ArrowDown');
  await name.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true
      })
    );
  });
  await expect(name).toHaveValue('be');
  await expect(quick.getByLabel('Make quantity')).toHaveCount(0);
  await expect(quick).toBeVisible();
  await name.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  );
  await name.press('Enter');
  await expect(quick.getByText('Recipe: Bean stew')).toBeVisible();
});

test('library starts empty; edits save across refresh, and invalid fields reset', async ({
  page
}) => {
  const popup = await library(page);
  await expect(popup.getByText('No recipes yet.')).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 700)
    await expect(popup.getByLabel('New recipe name')).toBeFocused();
  else await expect(popup).toBeFocused();
  await popup.getByLabel('New recipe name').fill('Bean stew');
  await popup.getByLabel('New recipe name').press('Enter');
  await expect(popup.getByLabel('Recipe yield')).toHaveValue('4');
  await popup.getByLabel('Recipe yield').fill('6');
  await popup.getByLabel('Recipe yield').press('Tab');
  await popup.getByLabel('Recipe duration minutes').fill('90');
  await popup.getByLabel('Recipe duration minutes').press('Tab');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).fill('3 carrots');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).press('Enter');
  await expect(popup.locator('.recipe-ingredient-row')).toHaveCount(1);
  await popup.getByLabel('Recipe instructions').fill('Simmer slowly.');
  await popup.getByLabel('Recipe instructions').press('Tab');
  await popup.getByLabel('Recipe yield').fill('-2');
  await popup.getByLabel('Recipe yield').press('Tab');
  await expect(popup.getByLabel('Recipe yield')).toHaveValue('6');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  const reopened = await library(page);
  await reopened.getByRole('button', { name: /Bean stew/ }).click();
  await expect(reopened.getByLabel('Recipe yield')).toHaveValue('6');
  await expect(reopened.getByLabel('Recipe duration minutes')).toHaveValue('90');
  await expect(reopened.getByLabel('Recipe quantity for carrots')).toHaveValue('3');
  await expect(reopened.getByLabel('Recipe instructions')).toHaveValue('Simmer slowly.');
});

test('recipe copies scale independently without creating raw food or allocations', async ({
  page
}) => {
  const before = await savedPlan(page);
  const requests: KitchenPlan[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/plan') && request.method() === 'PUT')
      requests.push(request.postDataJSON().plan as KitchenPlan);
  });
  const popup = await addRecipe(page);
  await popup.getByLabel('Recipe duration minutes').fill('90');
  await popup.getByLabel('Recipe duration minutes').press('Tab');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).fill('3 carrots');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).press('Enter');
  await popup.getByLabel('Recipe instructions').fill('Simmer slowly.');
  await popup.getByLabel('Recipe instructions').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  const firstQuick = await quickAt(page);
  await selectRecipe(firstQuick);
  await expect(firstQuick.getByText('90 minutes. Adjust on the card.')).toBeVisible();
  await expect(page.locator('.drag-preview')).toHaveCSS('height', '112.5px');
  await firstQuick.getByLabel('Activity name').fill('Stew Monday');
  await firstQuick.getByLabel('Make quantity').fill('8');
  await firstQuick.getByRole('button', { name: 'Add to plan' }).click();
  const first = page.locator('.time-card').filter({ hasText: 'Stew Monday' });
  await expect(first).toBeVisible();
  await addPlaced(page, 'Stew again', '2');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const snapshot = requests.at(-1)!;
  const copies = snapshot.activities.filter((a) => a.title.startsWith('Stew'));
  expect(copies).toHaveLength(2);
  expect(copies.map((a) => a.notes)).toEqual(['Simmer slowly.', 'Simmer slowly.']);
  expect(
    copies.map((a) => snapshot.activityRequirements.find((r) => r.activityId === a.id)?.quantity)
  ).toEqual([6, 1.5]);
  expect(
    snapshot.batches
      .filter((b) => {
        const source = b.source;
        return source.kind === 'activity' && copies.some((a) => a.id === source.activityId);
      })
      .map((b) => b.quantity)
  ).toEqual([8, 2]);
  expect(snapshot.ingredients).toEqual(before.ingredients);
  expect(snapshot.ingredientUses).toEqual(before.ingredientUses);
  expect(snapshot.allocations).toEqual(before.allocations);
  await first.getByRole('button', { name: 'Edit Stew Monday' }).click();
  const activity = page.getByRole('dialog', { name: 'Activity' });
  await activity.getByText('Edit ingredient notes', { exact: true }).click();
  await expect(activity.getByLabel('Activity quantity for carrots')).toHaveValue('6');
  await activity.getByLabel('Amount made of Bean stew').fill('10');
  await activity.getByLabel('Amount made of Bean stew').press('Tab');
  await expect(activity.getByLabel('Activity quantity for carrots')).toHaveValue('6');
  await activity.getByLabel('Activity quantity for carrots').fill('7');
  await activity.getByLabel('Activity quantity for carrots').press('Tab');
  await expect(activity.getByLabel('Activity quantity for carrots')).toHaveValue('7');
  await activity.getByLabel('Activity ingredient 1 name').fill('Roasted carrots');
  await activity.getByLabel('Activity ingredient 1 name').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const edited = await savedPlan(page);
  expect(edited.recipes).toEqual(snapshot.recipes);
  expect(edited.activityRequirements.filter((r) => r.activityId === copies[1].id)).toEqual(
    snapshot.activityRequirements.filter((r) => r.activityId === copies[1].id)
  );
});

test('drawn time wins over recipe duration; kind changes restore the supplied duration', async ({
  page
}) => {
  const popup = await addRecipe(page);
  await popup.getByLabel('Recipe duration minutes').fill('90');
  await popup.getByLabel('Recipe duration minutes').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.locator('.calendar-scroll').evaluate((element) => {
    element.scrollTop = 9 * 75;
    element.scrollLeft = 0;
  });
  const rect = await page.locator('[data-time-day]').first().boundingBox();
  if (!rect) throw new Error('Calendar day missing');
  const x = rect.x + rect.width / 2;
  const y = rect.y + 600 * 1.25 + 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 75 * 1.25, { steps: 12 });
  await page.mouse.up();
  const quick = page.getByRole('dialog', { name: 'Quick add' });
  await selectRecipe(quick);
  await expect(quick.getByText('75 minutes. Adjust on the card.')).toBeVisible();
  await expect(page.locator('.drag-preview')).toHaveCSS('height', '93.75px');
  await quick.getByRole('button', { name: 'Anything', exact: true }).click();
  await expect(quick.getByText('75 minutes. Adjust on the card.')).toBeVisible();
  await quick.getByRole('button', { name: 'Cook', exact: true }).click();
  await expect(quick.getByLabel('Make quantity')).toHaveCount(0);
  await selectRecipe(quick);
  await quick.getByLabel('Activity name').fill('Drawn stew');
  await quick.getByLabel('Activity name').press('Enter');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const placed = await savedPlan(page);
  expect(
    placed.activities.find((activity) => activity.title === 'Drawn stew')?.elapsedMinutes
  ).toBe(75);
  const clicked = await quickAt(page, 840);
  await selectRecipe(clicked);
  await expect(clicked.getByText('90 minutes. Adjust on the card.')).toBeVisible();
  await clicked.getByRole('button', { name: 'Eat', exact: true }).click();
  await expect(clicked.getByText('45 minutes. Adjust on the card.')).toBeVisible();
  await expect(page.locator('.drag-preview')).toHaveCSS('height', `${MIN_CARD_HEIGHT}px`);
  await page.keyboard.press('Escape');
  expect(await savedPlan(page)).toEqual(placed);
});

test('library edits and deletion leave copies intact; undo restores the recipe', async ({
  page
}) => {
  const popup = await addRecipe(page);
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).fill('2 carrots');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Close details' }).click();
  const card = await addPlaced(page, 'Stew template dinner', '4');
  const reopened = await library(page);
  await reopened.getByRole('button', { name: /Bean stew/ }).click();
  await reopened.getByLabel('Recipe name').fill('Bean soup');
  await reopened.getByLabel('Recipe name').press('Tab');
  await reopened.getByRole('button', { name: 'Delete recipe' }).click();
  await expect(reopened.getByText('No recipes yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  const restored = await library(page);
  await expect(restored.getByRole('button', { name: /Bean soup/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).click();
  await card.getByRole('button', { name: 'Edit Stew template dinner' }).click();
  await page.getByText('Edit ingredient notes', { exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Activity' }).getByLabel('Activity quantity for carrots')
  ).toHaveValue('2');
});

test('copied requirements can change and be removed without changing raw food; undo removes placement', async ({
  page
}) => {
  const popup = await addRecipe(page);
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).fill('2 carrots');
  await popup.getByLabel('Add Recipe ingredient', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Close details' }).click();
  const card = await addPlaced(page, 'Stew night', '4');
  await card.getByRole('button', { name: 'Edit Stew night' }).click();
  const activity = page.getByRole('dialog', { name: 'Activity' });
  await activity.getByText('Edit ingredient notes', { exact: true }).click();
  await activity.getByLabel('Add Activity ingredient', { exact: true }).fill('1 tomato');
  await activity.getByLabel('Add Activity ingredient', { exact: true }).press('Enter');
  await expect(activity.getByLabel('Activity quantity for tomato')).toHaveValue('1');
  await activity.getByRole('button', { name: 'Remove Activity ingredient tomato' }).click();
  await expect(activity.getByLabel('Activity quantity for tomato')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await card.getByRole('button', { name: 'Edit Stew night' }).click();
  await page.getByText('Edit ingredient notes', { exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Activity' }).getByLabel('Activity quantity for tomato')
  ).toHaveValue('1');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(card).toHaveCount(0);
});

test('year-end recipe selection rejects an overflowing preview and does not save', async ({
  page
}) => {
  const popup = await addRecipe(page);
  await popup.getByLabel('Recipe duration minutes').fill('180');
  await popup.getByLabel('Recipe duration minutes').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByLabel('Jump to date').fill('9999-12-25');
  const lastDay = page.locator('[data-time-day]').last();
  await expect(lastDay).toHaveAttribute('data-time-day', '9999-12-31');
  await lastDay.locator('.empty-calendar').evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    button.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        detail: 1,
        clientY: bounds.top + 22 * 60 * 1.25
      })
    );
  });
  const quick = page.getByRole('dialog', { name: 'Quick add' });
  await expect(quick).toBeVisible();
  await selectRecipe(quick);
  await expect(page.getByRole('alert')).toContainText('supported calendar');
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await quick.getByRole('button', { name: 'Add to plan' }).click();
  await expect(quick).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.time-card').filter({ hasText: 'Bean stew' })).toHaveCount(0);
});

test('library stays readable in light and dark on desktop and phone; outside click dismisses', async ({
  page
}, info) => {
  const created = await addRecipe(page);
  await created.getByLabel('Add Recipe ingredient', { exact: true }).fill('2 carrots');
  await created.getByLabel('Add Recipe ingredient', { exact: true }).press('Enter');
  await created.getByLabel('Recipe instructions').fill('Simmer until the carrots are tender.');
  await created.getByLabel('Recipe instructions').press('Tab');
  await page.getByRole('button', { name: 'Close details' }).click();
  for (const theme of ['light', 'dark']) {
    for (let i = 0; i < 3; i++) {
      if ((await page.locator('html').getAttribute('data-theme')) === theme) break;
      await page.locator('.theme-toggle').click();
    }
    const popup = await library(page);
    const input = popup.getByLabel('New recipe name');
    const dimensions = await input.evaluate((element) => {
      const panel = element.closest('.quick-popover')!;
      const foreground = getComputedStyle(panel).color;
      const background = getComputedStyle(panel).backgroundColor;
      return { height: element.getBoundingClientRect().height, foreground, background };
    });
    expect(dimensions.height).toBeGreaterThanOrEqual(35);
    expect(dimensions.foreground).not.toBe(dimensions.background);
    expect(await textContrast(popup.locator('.recipe-library-list small'))).toBeGreaterThanOrEqual(
      4.5
    );
    await popup.getByRole('button', { name: /Bean stew/ }).click();
    for (const locator of [
      popup.getByLabel('Recipe name'),
      popup.getByLabel('Recipe yield'),
      popup.getByLabel('Recipe duration minutes'),
      popup.getByLabel('Recipe ingredient 1 name'),
      popup.getByLabel('Recipe quantity for carrots'),
      popup.locator('.quiet.small').first(),
      popup.locator('.recipe-fields label').first()
    ])
      expect(await textContrast(locator)).toBeGreaterThanOrEqual(4.5);
    const bounds = await popup.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await popup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
    await page.screenshot({
      path: info.outputPath(`${theme}-recipes.png`),
      fullPage: true
    });
    await page.locator('.brand').click();
    await expect(popup).toHaveCount(0);
  }
  await expect(page.locator('.time-card').filter({ hasText: 'Bean stew' })).toHaveCount(0);
});

test('blank activity keeps direct calendar flow; dismissal does not create anything', async ({
  page
}) => {
  const popup = await addRecipe(page);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  const quick = await quickAt(page);
  await expect(quick.getByRole('combobox', { name: 'Activity name' })).toHaveValue('');
  await selectRecipe(quick);
  await quick.getByRole('button', { name: 'Eat', exact: true }).click();
  await expect(quick.getByLabel('Make quantity')).toHaveCount(0);
  await expect(quick.getByLabel('Activity name')).toHaveValue('Bean stew');
  await page.keyboard.press('Escape');
  await expect(quick).toHaveCount(0);
  await expect(page.locator('.time-card').filter({ hasText: 'Bean stew' })).toHaveCount(0);
  const next = await quickAt(page);
  await expect(next.getByRole('combobox', { name: 'Activity name' })).toHaveValue('');
  await next.getByLabel('Activity name').fill('Fresh cooking');
  await next.getByLabel('Activity name').press('Enter');
  await expect(page.locator('.time-card').filter({ hasText: 'Fresh cooking' })).toBeVisible();
});
