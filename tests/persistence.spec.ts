import { test, expect, type Page } from '@playwright/test';
import { request as nodeRequest } from 'node:http';
import { createKitchenPlan } from '../src/lib/kitchen';
import { startOfWeek, todayDay } from '../src/lib/calendar';
import type { PlanDocument } from '../src/lib/plan-document';

test.describe.configure({ mode: 'default' });
const saved = (page: Page) =>
  expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
async function addIngredient(page: Page, name: string) {
  const tray = page.locator('.home-tray');
  await expect(tray).toBeVisible();
  await page.getByLabel('Add ingredient', { exact: true }).fill(name);
  await page.getByLabel('Add ingredient', { exact: true }).press('Enter');
}

test.beforeEach(async ({ request }) => {
  // The server is started with a fresh temporary SQLite path, never the household database.
  const response = await request.get('/api/plan');
  expect(response.ok()).toBe(true);
  const document = (await response.json()) as PlanDocument;
  const reset = await request.put('/api/plan', {
    data: {
      schemaVersion: 2,
      revision: document.revision,
      plan: createKitchenPlan(startOfWeek(todayDay()))
    }
  });
  expect(reset.ok()).toBe(true);
});

test('saves the graph across refresh and a separate phone browser context', async ({
  page,
  request,
  browser
}) => {
  await page.goto('/');
  await saved(page);
  await addIngredient(page, '3 zucchini');
  await saved(page);
  await page.getByTestId('food-ing-paprika').click();
  const popup = page.getByRole('dialog', { name: 'Ingredient', exact: true });
  await popup.getByLabel('Use in activity').selectOption('cook-curry');
  await popup.getByLabel('Amount to assign').fill('1');
  await popup.getByRole('button', { name: 'Use here', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Close details' }).click();
  const before = (await (await request.get('/api/plan')).json()) as PlanDocument;
  expect(before.plan.ingredientUses).toContainEqual(
    expect.objectContaining({ ingredientId: 'ing-paprika', activityId: 'cook-curry', quantity: 1 })
  );
  expect(before.plan.allocations).toEqual(createKitchenPlan(startOfWeek(todayDay())).allocations);
  await page.reload();
  await saved(page);
  await expect(page.getByTestId('food-ing-paprika')).toContainText('1 still unplanned');
  expect(await (await request.get('/api/plan')).json()).toEqual(before);
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  try {
    const other = await phone.newPage();
    await other.goto('http://127.0.0.1:4173/');
    await saved(other);
    await expect(other.locator('.home-tray')).toBeVisible();
    await expect(other.locator('.ingredient-chip').filter({ hasText: 'zucchini' })).toContainText(
      '3 still unplanned'
    );
    await expect(other.getByTestId('food-ing-paprika')).toContainText('1 still unplanned');
  } finally {
    await phone.close();
  }
});

test('numeric-only editing preserves hidden v1 metadata in the saved PUT', async ({
  page,
  request
}) => {
  const before = (await (await request.get('/api/plan')).json()) as PlanDocument;
  const legacy = structuredClone(before.plan);
  const curry = legacy.activities.find((activity) => activity.id === 'cook-curry')!;
  curry.handsOnMinutes = 17;
  curry.requiresHome = true;
  legacy.batches.find((batch) => batch.id === 'curry')!.unit = 'legacy portions';
  const seed = await request.put('/api/plan', {
    data: { schemaVersion: 2, revision: before.revision, plan: legacy }
  });
  expect(seed.ok()).toBe(true);
  const puts: PlanDocument['plan'][] = [];
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() === 'PUT') puts.push(route.request().postDataJSON().plan);
    await route.continue();
  });
  await page.goto('/');
  await saved(page);
  await page
    .getByTestId('activity-cook-curry')
    .getByRole('button', { name: 'Edit Cook coconut curry' })
    .click();
  const popup = page.getByRole('dialog', { name: 'Activity' });
  await expect(popup.getByLabel(/hands-on|home|unit/i)).toHaveCount(0);
  await popup.getByLabel('Duration minutes').fill('55');
  await popup.getByLabel('Duration minutes').press('Tab');
  await saved(page);
  expect(puts.length).toBeGreaterThan(0);
  for (const plan of puts) {
    expect(plan.activities.find((activity) => activity.id === 'cook-curry')).toEqual(
      expect.objectContaining({ handsOnMinutes: 17, requiresHome: true })
    );
    expect(plan.batches.find((batch) => batch.id === 'curry')?.unit).toBe('legacy portions');
  }
  const after = (await (await request.get('/api/plan')).json()) as PlanDocument;
  expect(
    after.plan.activities.find((activity) => activity.id === 'cook-curry')?.elapsedMinutes
  ).toBe(55);
  expect(after.plan.batches.find((batch) => batch.id === 'curry')?.unit).toBe('legacy portions');
});

test('does not offer an editable example when loading fails', async ({ page, request }) => {
  const before = await (await request.get('/api/plan')).json();
  let writes = 0;
  await page.route('**/api/plan', (route) => {
    if (route.request().method() === 'PUT') writes++;
    return route.fulfill({ status: 503, json: { error: 'Offline' } });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Could not load');
  await expect(page.locator('.empty-calendar')).toHaveCount(0);
  await expect(page.locator('[data-time-day]')).toHaveCount(0);
  expect(writes).toBe(0);
  await page.unroute('**/api/plan');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await saved(page);
  expect(await (await request.get('/api/plan')).json()).toEqual(before);
});

test('keeps offline changes through refresh and retries them without loss', async ({
  page,
  request
}) => {
  await page.goto('/');
  await saved(page);
  await page.route('**/api/plan', (route) =>
    route.request().method() === 'PUT' ? route.abort('failed') : route.continue()
  );
  await addIngredient(page, '4 offline tomatoes');
  await expect(page.getByRole('alert')).toContainText('Could not save');
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(
    page.locator('.ingredient-chip').filter({ hasText: 'offline tomatoes' })
  ).toContainText('4 still unplanned');
  // A failed bootstrap GET must not hide the tab's recoverable unsaved work.
  await page.unroute('**/api/plan');
  await page.route('**/api/plan', (route) => route.abort('failed'));
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Could not load');
  await expect(page.getByRole('button', { name: 'Download local changes' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local changes' }).click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain('offline tomatoes');
  await page.unroute('**/api/plan');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await saved(page);
  const document = (await (await request.get('/api/plan')).json()) as PlanDocument;
  expect(document.plan.ingredients.filter((item) => item.name === 'offline tomatoes')).toHaveLength(
    1
  );
  await page.reload();
  await saved(page);
  await expect(
    page.locator('.ingredient-chip').filter({ hasText: 'offline tomatoes' })
  ).toContainText('4 still unplanned');
});

test('protects edits on another tab and offers download before explicit reload', async ({
  page,
  context,
  request
}) => {
  await page.goto('/');
  await saved(page);
  const other = await context.newPage();
  await other.goto('/');
  await saved(other);
  await addIngredient(page, '2 first-tab apples');
  await saved(page);
  await addIngredient(other, '3 second-tab pears');
  await expect(other.getByRole('alert')).toContainText('Another tab or device');
  const server = (await (await request.get('/api/plan')).json()) as PlanDocument;
  expect(server.plan.ingredients.some((item) => item.name === 'first-tab apples')).toBe(true);
  expect(server.plan.ingredients.some((item) => item.name === 'second-tab pears')).toBe(false);
  const downloading = other.waitForEvent('download');
  await other.getByRole('button', { name: 'Download local changes' }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain('second-tab pears');
  other.once('dialog', (dialog) => dialog.dismiss());
  await other.getByRole('button', { name: 'Load saved plan' }).click();
  await expect(
    other.locator('.ingredient-chip').filter({ hasText: 'second-tab pears' })
  ).toBeVisible();
  other.once('dialog', (dialog) => dialog.accept());
  await other.getByRole('button', { name: 'Load saved plan' }).click();
  await saved(other);
  await expect(
    other.locator('.ingredient-chip').filter({ hasText: 'second-tab pears' })
  ).toHaveCount(0);
  await expect(
    other.locator('.ingredient-chip').filter({ hasText: 'first-tab apples' })
  ).toBeVisible();
  expect(await (await request.get('/api/plan')).json()).toEqual(server);
  await other.close();
});

test('persists undo even when the previous save acknowledgement was lost', async ({
  page,
  request
}) => {
  await page.goto('/');
  await saved(page);
  let first = true;
  await page.route('**/api/plan', async (route) => {
    if (route.request().method() === 'PUT' && first) {
      first = false;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await addIngredient(page, '6 undo carrots');
  await expect(page.getByRole('alert')).toContainText('Could not save');
  expect(
    ((await (await request.get('/api/plan')).json()) as PlanDocument).plan.ingredients.some(
      (item) => item.name === 'undo carrots'
    )
  ).toBe(true);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  await expect(page.locator('.ingredient-chip').filter({ hasText: 'undo carrots' })).toHaveCount(0);
  expect(
    ((await (await request.get('/api/plan')).json()) as PlanDocument).plan.ingredients.some(
      (item) => item.name === 'undo carrots'
    )
  ).toBe(false);
});

test('rejects malformed, oversized, cross-origin, and stale writes atomically', async ({
  request
}) => {
  const initial = (await (await request.get('/api/plan')).json()) as PlanDocument;
  const body = { schemaVersion: 2, revision: initial.revision, plan: initial.plan };
  expect(
    (
      await request.put('/api/plan', {
        headers: { Origin: 'https://untrusted.example' },
        data: body
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await request.put('/api/plan', {
        headers: { 'Content-Type': 'text/plain', Origin: 'http://127.0.0.1:4173' },
        data: 'invalid'
      })
    ).status()
  ).toBe(415);
  expect(
    (
      await request.put('/api/plan', {
        headers: { 'Content-Type': 'application/json' },
        data: '{broken'
      })
    ).status()
  ).toBe(400);
  expect((await request.put('/api/plan', { data: { ...body, schemaVersion: 99 } })).status()).toBe(
    400
  );
  const malformed = structuredClone(body);
  malformed.plan.allocations[0].batchId = 'missing-batch';
  expect((await request.put('/api/plan', { data: malformed })).status()).toBe(400);
  expect(
    (
      await request.put('/api/plan', {
        headers: { 'Content-Type': 'application/json' },
        data: 'x'.repeat(600_000)
      })
    ).status()
  ).toBe(413);
  expect(await (await request.get('/api/plan')).json()).toEqual(initial);
  const chunkedStatus = await new Promise<number>((resolve, reject) => {
    const upload = nodeRequest(
      'http://127.0.0.1:4173/api/plan',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode!));
        response.on('error', reject);
      }
    );
    upload.on('error', reject);
    upload.end('x'.repeat(600_000));
  });
  expect(chunkedStatus).toBe(413);
  expect(await (await request.get('/api/plan')).json()).toEqual(initial);
  const changed = structuredClone(body);
  changed.plan.ingredients[0].quantity = 8;
  const write = await request.put('/api/plan', { data: changed });
  expect(write.status()).toBe(200);
  const written = await write.json();
  const retry = await request.put('/api/plan', { data: changed });
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual(written);
  expect((await request.put('/api/plan', { data: body })).status()).toBe(409);
  const final = await request.get('/api/plan');
  expect(final.headers()['cache-control']).toBe('no-store');
  expect(await final.json()).toEqual(written);
});

test('rejects legacy v1 PUTs even when they normalize to the saved plan', async ({ request }) => {
  const before = (await (await request.get('/api/plan')).json()) as PlanDocument;
  const { recipes: _recipes, activityRequirements: _requirements, ...legacy } = before.plan;
  const response = await request.put('/api/plan', {
    data: { schemaVersion: 1, revision: before.revision, plan: legacy }
  });
  expect(response.status()).toBe(400);
  expect(await (await request.get('/api/plan')).json()).toEqual(before);
  // Relabeling current data as v1 must not bypass strict migration or API version validation.
  expect(
    (
      await request.put('/api/plan', {
        data: { schemaVersion: 1, revision: before.revision, plan: before.plan }
      })
    ).status()
  ).toBe(400);
  expect(await (await request.get('/api/plan')).json()).toEqual(before);
});

test('preserves an unreadable recovery file until discard is confirmed', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('meal-prep:unsaved-plan:v1', '{broken'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('recovery copy that cannot be read');
  await expect(page.locator('.empty-calendar')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Load saved plan' }).click();
  await saved(page);
  expect(await page.evaluate(() => sessionStorage.getItem('meal-prep:unsaved-plan:v1'))).toBeNull();
});
