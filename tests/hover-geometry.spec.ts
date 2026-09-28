import { expect, test, type Page } from '@playwright/test';
import { addDays, startOfWeek, todayDay } from '../src/lib/calendar';
import { createKitchenPlan, type KitchenPlan } from '../src/lib/kitchen';
import type { PlanDocument } from '../src/lib/plan-document';

const week = startOfWeek(todayDay());
function graph(): KitchenPlan {
  const plan = createKitchenPlan(week);
  const template = plan.activities[0];
  const activity = (id: string, day: number, minute: number, elapsedMinutes = 45) => ({
    ...template,
    id,
    title: id,
    start: { day: addDays(week, day), minute },
    elapsedMinutes
  });
  plan.activities = [
    activity('source', 0, 810),
    activity('side', 0, 840, 30),
    activity('meal', 0, 940, 30),
    activity('adjacent', 1, 920, 30),
    activity('distant', 3, 930, 30),
    activity('outside', 8, 750),
    activity('overnight', -1, 1380, 900)
  ];
  plan.batches = [
    ...plan.batches.filter((batch) => batch.source.kind === 'existing'),
    ...['source', 'side', 'overnight'].map((id) => ({
      id: `batch-${id}`,
      name: `${id} food`,
      quantity: 20,
      unit: '',
      source: { kind: 'activity' as const, activityId: id }
    }))
  ];
  plan.allocations = [
    ...['meal', 'adjacent', 'distant', 'outside'].map((id) => ({
      id: `link-${id}`,
      batchId: 'batch-source',
      activityId: id,
      quantity: 2,
      purpose: 'eat' as const,
      when: 'start' as const
    })),
    {
      id: 'link-parallel',
      batchId: 'batch-source',
      activityId: 'meal',
      quantity: 1,
      purpose: 'ingredient',
      when: 'end'
    },
    {
      id: 'link-side',
      batchId: 'batch-side',
      activityId: 'meal',
      quantity: 1,
      purpose: 'eat',
      when: 'start'
    },
    {
      id: 'link-overnight',
      batchId: 'batch-overnight',
      activityId: 'meal',
      quantity: 1,
      purpose: 'eat',
      when: 'start'
    }
  ];
  plan.blockers = [
    {
      id: 'gray',
      title: 'All-day blocked',
      start: { day: addDays(week, 1), minute: 0 },
      durationMinutes: 1440,
      away: false
    }
  ];
  plan.ingredientUses = [];
  plan.activityRequirements = [];
  return plan;
}
async function load(page: Page, plan = graph()) {
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
  return writes;
}
async function frame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const scroll = document.querySelector('.calendar-scroll')!;
    const rect = (element: Element) => {
      const b = element.getBoundingClientRect();
      return [b.x, b.y, b.width, b.height];
    };
    return {
      rects: Array.from(
        document.querySelectorAll(
          '.home-tray, .calendar-shell, .calendar-scroll, .calendar-day-header, .time-card, .time-block'
        ),
        rect
      ),
      scroll: [scroll.scrollTop, scroll.scrollLeft, scroll.scrollWidth, scroll.scrollHeight]
    };
  });
}
async function moveTo(page: Page, id: string) {
  const rect = (await page.locator(`[data-activity-id="${id}"] .time-card-main`).boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + Math.min(rect.height / 2, 20), {
    steps: 20
  });
  await frame(page);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`${colorScheme}: real repeated off-range/on-range hover never moves the calendar or stock`, async ({
    page,
    isMobile
  }) => {
    test.skip(isMobile, 'Real mouse geometry; touch is tested separately.');
    await page.emulateMedia({ colorScheme });
    const writes = await load(page);
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.locator('.calendar-scroll').evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.mouse.move(30, 100);
    await frame(page);
    const before = await geometry(page);
    for (let pass = 0; pass < 3; pass++) {
      for (const id of ['source', 'meal', 'side', 'source', 'meal', 'source']) {
        await moveTo(page, id);
        expect(await geometry(page)).toEqual(before);
        if (id === 'source') {
          const overlay = page.locator('.relationship-strip');
          await expect(overlay).toBeVisible();
          const b = (await overlay.boundingBox())!;
          expect(b.width).toBeGreaterThanOrEqual(200);
          const card = (await page.locator('[data-activity-id="source"]').boundingBox())!;
          expect(
            b.x >= card.x + card.width ||
              b.x + b.width <= card.x ||
              b.y >= card.y + card.height ||
              b.y + b.height <= card.y
          ).toBe(true);
          // Travel through blank space, not through another card (which deliberately
          // starts its own relationship context). Every intermediate point is real.
          await page.mouse.move(b.x + b.width - 20, card.y + 20, { steps: 20 });
          await page.mouse.move(b.x + b.width - 20, b.y + 20, { steps: 20 });
          expect(await overlay.boundingBox()).toEqual(b);
          expect(await geometry(page)).toEqual(before);
        }
      }
      await page.mouse.move(30, 100, { steps: 20 });
      await frame(page);
      await expect(page.locator('.relationship-strip')).toHaveCount(0);
      expect(await geometry(page)).toEqual(before);
    }
    // Native Tab may reveal the earlier overnight card while traversing it.
    // Its intentional focus scrolling is distinct from relationship layout.
    for (
      let n = 0;
      n < 20 &&
      !(await page
        .getByRole('button', { name: 'Edit source', exact: true })
        .evaluate((e) => e === document.activeElement));
      n++
    )
      await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Edit source', exact: true })).toBeFocused();
    await frame(page);
    const keyboard = await geometry(page);
    expect(keyboard.rects.slice(0, 10)).toEqual(before.rects.slice(0, 10));
    await moveTo(page, 'source');
    expect(await geometry(page)).toEqual(keyboard);
    await page.mouse.move(30, 100, { steps: 20 });
    await frame(page);
    expect(await geometry(page)).toEqual(keyboard);
    expect(writes).toHaveLength(0);
  });
}

test('rendered routes retain exact endpoints, bounded trunks, parallel identities and safe optional labels', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'Desktop SVG inspection');
  await load(page);
  await moveTo(page, 'source');
  await expect(page.locator('.food-connection')).toHaveCount(4);
  const paths = await page.locator('.food-connection').evaluateAll((elements) =>
    elements.map((element) => {
      const path = element as SVGPathElement;
      const start = path.getPointAtLength(0),
        end = path.getPointAtLength(path.getTotalLength());
      return {
        d: path.getAttribute('d')!,
        ids: JSON.parse(path.getAttribute('data-allocation-ids')!),
        marker: path.getAttribute('marker-end'),
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y }
      };
    })
  );
  expect(new Set(paths.map((path) => path.d)).size).toBe(4);
  for (const path of paths) {
    expect(path.marker).toBe('url(#food-arrow)');
    expect(path.start.y).toBe(54 + 855 * 1.25);
    const id = path.ids[0].replace('link-', '');
    const targetMinute =
      id === 'parallel' ? 970 : id === 'meal' ? 940 : id === 'adjacent' ? 920 : 930;
    expect(path.end.y).toBe(54 + targetMinute * 1.25);
    if (id !== 'distant') expect(path.d.match(/V/g)).toHaveLength(1);
    const verticals = [...path.d.matchAll(/V([\d.]+)/g)].map((match) => Number(match[1]));
    expect(verticals.every((y) => y >= path.start.y && y <= path.end.y)).toBe(true);
  }
  const labels = await page.locator('.connection-label').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = document.querySelector('.calendar-scroll')!.getBoundingClientRect();
      return {
        text: element.textContent,
        inside:
          rect.left >= viewport.left &&
          rect.right <= viewport.right &&
          rect.top >= viewport.top + 54 &&
          rect.bottom <= viewport.bottom,
        hitsCard: Array.from(document.querySelectorAll('.time-card, .time-block')).some((card) => {
          const other = card.getBoundingClientRect();
          return (
            rect.left < other.right &&
            rect.right > other.left &&
            rect.top < other.bottom &&
            rect.bottom > other.top
          );
        })
      };
    })
  );
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((label) => label.inside && !label.hitsCard)).toBe(true);
  const changed = graph();
  changed.batches.find((batch) => batch.id === 'batch-source')!.name =
    'Very long food name '.repeat(30);
  await load(page, changed);
  await moveTo(page, 'source');
  expect(
    await page
      .locator('.food-connection')
      .evaluateAll((elements) => elements.map((e) => e.getAttribute('d')))
  ).toEqual(paths.map((path) => path.d));
  await moveTo(page, 'meal');
  await expect(page.locator('.food-connection')).toHaveCount(4);
  expect(
    await page
      .locator('.food-connection')
      .evaluateAll((elements) =>
        elements.some(
          (e) =>
            e.getAttribute('data-allocation-ids') === '["link-overnight"]' &&
            e.getAttribute('d')!.startsWith('M')
        )
      )
  ).toBe(true);
});

test('an open inspector adapts across phone and desktop breakpoints without stale height limits', async ({
  page
}) => {
  const writes = await load(page);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Recipes', exact: true }).click();
    const panel = page.locator('.detail-inspector');
    await expect(panel).toBeVisible();
    const phone = (await panel.boundingBox())!;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(panel).toHaveCSS('max-height', 'none');
    await expect
      .poll(async () => {
        const bounds = (await panel.boundingBox())!;
        return Math.abs(bounds.y + bounds.height - 986);
      })
      .toBeLessThan(1);
    expect((await panel.boundingBox())!.height).toBeGreaterThan(phone.height);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await panel.boundingBox())!.height).toBe(phone.height);
    await page.getByRole('button', { name: 'Close details' }).click();
  }
  expect(writes).toHaveLength(0);
});

test('a later calendar card offers a direct keyboard path to its off-range relationship', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'Keyboard traversal is exercised on desktop.');
  const plan = graph();
  plan.activities.unshift({
    ...plan.activities[0],
    id: 'preceding',
    title: 'Earlier grocery activity',
    start: { day: week, minute: 720 },
    elapsedMinutes: 30
  });
  const writes = await load(page, plan);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  const source = page.getByRole('button', { name: 'Edit source', exact: true });
  let traversedEarlier = false;
  for (let step = 0; step < 30; step++) {
    const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    traversedEarlier ||= label === 'Edit Earlier grocery activity';
    if (label === 'Edit source') break;
    await page.keyboard.press('Tab');
  }
  expect(traversedEarlier).toBe(true);
  await expect(source).toBeFocused();
  await expect(page.locator('.relationship-strip')).toBeVisible();
  await frame(page);
  const before = await geometry(page);
  await page.keyboard.press('Tab');
  const jump = page.getByRole('button', {
    name: 'Follow food outside these dates for source',
    exact: true
  });
  await expect(jump).toBeFocused();
  await expect(jump).toHaveCSS('clip-path', 'none');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('.relationship-strip [data-allocation-id="link-outside"]')
  ).toBeFocused();
  expect(await geometry(page)).toEqual(before);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Activity name', { exact: true })).toHaveValue('outside');
  expect(writes).toHaveLength(0);
});

test('persistent stock shares the canonical detail surface with food, activity and recipes', async ({
  page,
  isMobile
}) => {
  const writes = await load(page);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const tray = page.getByRole('complementary', { name: 'At home' });
  const before = await tray.boundingBox();
  const click = async (locator: ReturnType<Page['locator']>) =>
    isMobile ? locator.tap() : locator.click();
  const surfaces = [];
  for (const opener of [
    page.getByTestId('food-ing-paprika'),
    page.getByTestId('agenda-source'),
    page.getByRole('button', { name: 'Recipes', exact: true })
  ]) {
    await click(opener);
    const panel = page.locator('.quick-popover.detail-inspector');
    await expect(panel).toBeVisible();
    expect(await tray.boundingBox()).toEqual(before);
    await expect(page.getByRole('heading', { name: 'Ingredients to use' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Already cooked' })).toBeInViewport();
    const bounds = (await panel.boundingBox())!;
    if (isMobile) expect(bounds.y).toBeGreaterThanOrEqual(before!.y + before!.height);
    else expect(bounds.x).toBeGreaterThan(before!.x + before!.width);
    surfaces.push(bounds);
    await click(panel.getByRole('button', { name: 'Close details' }));
  }
  for (const surface of surfaces) {
    expect(surface.x).toBe(surfaces[0].x);
    expect(surface.width).toBe(surfaces[0].width);
    expect(surface).toEqual(surfaces[0]);
  }
  expect(writes).toHaveLength(0);
  if (isMobile) {
    const row = tray.locator('.stock-row').first();
    await row.evaluate((element) =>
      element.addEventListener('scrollend', () =>
        element.setAttribute('data-scroll-state', 'settled')
      )
    );
    const rect = (await row.boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const from = { x: rect.x + 160, y: rect.y + rect.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let step = 1; step <= 10; step++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x - step * 12, y: from.y }]
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => row.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20);
    await expect(row).toHaveAttribute('data-scroll-state', 'settled');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.food-connection, .relationship-strip')).toHaveCount(0);
    expect(writes).toHaveLength(0);
    await session.detach();
    await page.getByRole('button', { name: 'Calendar', exact: true }).tap();
    await page.locator('.calendar-scroll').evaluate((element) => {
      element.scrollLeft = 0;
      element.scrollTop = 900;
    });
    const source = page.getByRole('button', { name: 'Edit source', exact: true });
    await source.scrollIntoViewIfNeeded();
    await frame(page);
    const calendarBefore = await geometry(page);
    await source.tap();
    await expect(page.locator('.detail-inspector')).toBeVisible();
    expect(await tray.boundingBox()).toEqual(before);
    await page.getByRole('button', { name: 'Close details' }).tap();
    await frame(page);
    await expect(page.locator('.food-connection, .relationship-strip')).toHaveCount(0);
    expect(await geometry(page)).toEqual(calendarBefore);
    expect(writes).toHaveLength(0);
    await page.getByRole('button', { name: 'Enter a new ingredient', exact: true }).tap();
    const input = page.getByLabel('Add ingredient', { exact: true });
    await expect(input).toBeFocused();
    await input.fill('2 Beans');
    await page.getByRole('button', { name: 'Add ingredient to use', exact: true }).tap();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    expect(writes).toHaveLength(1);
    expect(writes[0].ingredients.at(-1)?.name).toBe('Beans');
  }
});
