import { expect } from '@playwright/test';
import { test } from './fixtures';
import { DAY_GUTTER, MIN_DAY_WIDTH, TIME_RAIL_WIDTH } from '../src/lib/time-layout';

// Uses the in-memory plan fixture; clicking a gap must not create an activity.
test('headers track their day columns across resize and navigation; gaps are not create targets', async ({
  page
}) => {
  await page.goto('/');
  const grid = page.locator('.calendar-grid');
  async function assertLayout() {
    const geometry = await grid.evaluate((element) => {
      const canvas = element.getBoundingClientRect();
      const days = Array.from(element.querySelectorAll<HTMLElement>('[data-time-day]'));
      const headers = Array.from(element.querySelectorAll<HTMLElement>('.calendar-day-header'));
      return {
        canvas: { width: canvas.width, right: canvas.right },
        railWidth: element.querySelector('.hour-rail')!.getBoundingClientRect().width,
        minWidth: parseFloat(getComputedStyle(element).minWidth),
        columnGap: parseFloat(getComputedStyle(element).columnGap),
        headerTemplate: getComputedStyle(element.querySelector('.calendar-header')!)
          .gridTemplateColumns,
        bodyTemplate: getComputedStyle(element).gridTemplateColumns,
        days: days.map((day, index) => {
          const body = day.getBoundingClientRect();
          const header = headers[index].getBoundingClientRect();
          return {
            left: body.left,
            right: body.right,
            width: body.width,
            headerLeft: header.left,
            headerRight: header.right
          };
        })
      };
    });
    const { days, canvas } = geometry;
    expect(geometry.columnGap).toBe(DAY_GUTTER);
    const headerTracks = geometry.headerTemplate.split(' ').map(parseFloat);
    const bodyTracks = geometry.bodyTemplate.split(' ').map(parseFloat);
    expect(headerTracks).toHaveLength(bodyTracks.length);
    // Independent grids can round fractional tracks to adjacent 1/64px values.
    for (const [index, track] of headerTracks.entries())
      expect(track).toBeCloseTo(bodyTracks[index], 1);
    expect(geometry.railWidth).toBe(TIME_RAIL_WIDTH);
    expect(geometry.minWidth).toBe(
      TIME_RAIL_WIDTH + days.length * (MIN_DAY_WIDTH + DAY_GUTTER) + DAY_GUTTER
    );
    expect(canvas.width).toBeGreaterThanOrEqual(geometry.minWidth);
    for (let index = 0; index < days.length; index++) {
      expect(days[index].width).toBeGreaterThanOrEqual(MIN_DAY_WIDTH);
      expect(days[index].headerLeft).toBeCloseTo(days[index].left, 1);
      expect(days[index].headerRight).toBeCloseTo(days[index].right, 1);
      if (index) expect(days[index].left - days[index - 1].right).toBeCloseTo(DAY_GUTTER, 1);
    }
    expect(canvas.right - days.at(-1)!.right).toBeCloseTo(DAY_GUTTER, 1);
    return days;
  }
  let days = await assertLayout();
  const scroll = page.locator('.calendar-scroll');
  await scroll.evaluate((element) => {
    element.scrollTop = 9 * 75;
    element.scrollLeft = 0;
  });
  // The first gap is visible even on phone; hit it below the sticky header.
  days = await assertLayout();
  const viewport = await scroll.boundingBox();
  if (!viewport) throw new Error('Missing calendar viewport');
  await page.mouse.click((days[0].right + days[1].left) / 2, viewport.y + 85);
  await expect(page.getByRole('dialog', { name: 'Quick add' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo last change' })).toBeDisabled();
  await page.setViewportSize({ width: 800, height: 800 });
  await assertLayout();
  await page.getByRole('button', { name: 'One more day' }).click();
  await expect(page.locator('[data-time-day]')).toHaveCount(8);
  await assertLayout();
  await scroll.evaluate((element) => (element.scrollLeft = element.scrollWidth));
  await assertLayout();
});

test('opaque sticky header masks connection lines across gutters while scrolled', async ({
  page
}) => {
  await page.goto('/');
  const scroll = page.locator('.calendar-scroll');
  await scroll.evaluate((element) => {
    element.scrollTop = 920;
    element.scrollLeft = 0;
  });
  const coverage = await page.locator('.calendar-grid').evaluate((grid) => {
    const header = grid.querySelector<HTMLElement>('.calendar-header')!;
    const svg = grid.querySelector<SVGElement>('.calendar-connections')!;
    const days = Array.from(grid.querySelectorAll<HTMLElement>('[data-time-day]'));
    const headers = Array.from(header.querySelectorAll<HTMLElement>('.calendar-day-header'));
    const rect = header.getBoundingClientRect();
    const scroll = grid.closest<HTMLElement>('.calendar-scroll')!;
    const firstGap =
      (days[0].getBoundingClientRect().right + days[1].getBoundingClientRect().left) / 2;
    const gapHit = document.elementFromPoint(firstGap, rect.top + rect.height / 2);
    const style = getComputedStyle(header);
    const mask = getComputedStyle(header, '::after');
    return {
      scrolled: scroll.scrollTop,
      height: rect.height,
      top: rect.top,
      scrollTop: scroll.getBoundingClientRect().top,
      right: rect.right,
      lastDayRight: days.at(-1)!.getBoundingClientRect().right,
      headerZ: Number(style.zIndex),
      svgZ: Number(getComputedStyle(svg).zIndex),
      backing: style.backgroundColor,
      maskBacking: mask.backgroundColor,
      maskWidth: parseFloat(mask.width),
      gutterHitHeader: gapHit === header || header.contains(gapHit),
      aligned: days.every((day, index) => {
        const body = day.getBoundingClientRect();
        const head = headers[index].getBoundingClientRect();
        return Math.abs(body.left - head.left) < 0.1 && Math.abs(body.right - head.right) < 0.1;
      })
    };
  });
  expect(coverage.scrolled).toBe(920);
  expect(coverage.height).toBe(54);
  expect(coverage.top).toBeCloseTo(coverage.scrollTop, 1);
  expect(coverage.headerZ).toBeGreaterThan(coverage.svgZ);
  expect(coverage.backing).not.toBe('rgba(0, 0, 0, 0)');
  expect(coverage.maskBacking).toBe(coverage.backing);
  expect(coverage.maskWidth).toBe(DAY_GUTTER);
  expect(coverage.lastDayRight).toBeCloseTo(coverage.right, 1);
  expect(coverage.gutterHitHeader).toBe(true);
  expect(coverage.aligned).toBe(true);
});
