import { describe, expect, it } from 'vitest';
import { placeConnectionLabel, routeConnection, type ConnectionAnchor } from './connection-layout';

const columns = [
  { day: 'monday', left: 64, right: 204 },
  { day: 'tuesday', left: 216, right: 356 },
  { day: 'wednesday', left: 368, right: 508 }
];
const canvas = { left: 0, top: 0, right: 520 };
const anchor = (day: string, left: number, right: number, top: number): ConnectionAnchor => ({
  day,
  rect: { left, right, top, height: 40 }
});
const track = { index: 0, count: 1 };

describe('geometry-first connection rails', () => {
  it('uses one trunk on the same day or shared adjacent gutter, without reversal', () => {
    for (const [source, target, expected] of [
      [
        anchor('tuesday', 223, 272, 200),
        anchor('tuesday', 291, 348, 280),
        'M272,220 H362 V300 H348'
      ],
      [anchor('monday', 75, 190, 240), anchor('tuesday', 223, 348, 290), 'M190,260 H210 V310 H223'],
      [anchor('tuesday', 223, 348, 290), anchor('monday', 75, 190, 240), 'M223,310 H210 V260 H190']
    ] as const) {
      const route = routeConnection(source, target, columns, canvas, track)!;
      expect(route.d).toBe(expected);
      expect(route.d.match(/V/g)).toHaveLength(1);
      const start = route.points[0],
        end = route.points.at(-1)!;
      expect(
        route.points.every(
          (p) => p.y >= Math.min(start.y, end.y) && p.y <= Math.max(start.y, end.y)
        )
      ).toBe(true);
    }
  });
  it('uses actual obstacle boundaries inside the endpoint range, not label bands', () => {
    const route = routeConnection(
      { ...anchor('monday', 75, 190, 200), y: 250 },
      { ...anchor('wednesday', 380, 495, 290), y: 330 },
      columns,
      canvas,
      track,
      [{ left: 223, right: 348, top: 240, height: 40 }]
    )!;
    expect(route.d).toBe('M190,250 H210 V284 H362 V330 H380');
    expect(route.points.at(-1)).toEqual({ x: 380, y: 330 });
  });
  it('takes a bounded clear detour rather than passing behind an unrelated activity', () => {
    const route = routeConnection(
      { ...anchor('monday', 75, 190, 1300), y: 1404 },
      { ...anchor('wednesday', 380, 495, 1300), y: 1366.5 },
      columns,
      { ...canvas, bottom: 1860 },
      track,
      [{ left: 223, right: 348, top: 1310.25, height: 100 }]
    )!;
    expect(route.d).toBe('M190,1404 H210 V1414.25 H362 V1366.5 H380');
    expect(route.points.every((point) => point.y >= 1366.5 - 12 && point.y <= 1404 + 12)).toBe(
      true
    );
    expect(route.points.at(-1)).toEqual({ x: 380, y: 1366.5 });
  });
  it('bounds congestion fallback even behind a full-day blocker or at equal clocks', () => {
    for (const y of [250, 330]) {
      const route = routeConnection(
        { ...anchor('monday', 75, 190, 200), y: 250 },
        { ...anchor('wednesday', 380, 495, 290), y },
        columns,
        canvas,
        { index: 2, count: 4 },
        [{ left: 216, right: 356, top: 0, height: 2000 }]
      )!;
      expect(route.points.every((point) => point.y >= 250 - 12 && point.y <= y)).toBe(true);
      expect(route.points.at(-1)?.y).toBe(y);
    }
  });
  it('keeps congested equal-midnight crossings inside the canvas with the marker at 24:00', () => {
    const route = routeConnection(
      { ...anchor('monday', 75, 190, 1450), y: 1494 },
      { ...anchor('wednesday', 380, 495, 1450), y: 1494 },
      columns,
      { ...canvas, bottom: 1494 },
      { index: 9, count: 10 },
      [{ left: 216, right: 356, top: 0, height: 1494 }]
    )!;
    expect(route.points.every((point) => point.y >= 1494 - 12 && point.y <= 1494)).toBe(true);
    expect(route.points.at(-1)).toEqual({ x: 380, y: 1494 });
  });
  it('keeps parallel allocations on deterministic tracks inside measured gutters', () => {
    const routes = [0, 1, 2].map((index) =>
      routeConnection(
        { ...anchor('monday', 75, 190, 200), y: 250 },
        { ...anchor('wednesday', 380, 495, 290), y: 330 },
        columns,
        canvas,
        { index, count: 3 }
      )!
    );
    expect(new Set(routes.map((route) => route.d)).size).toBe(3);
    for (const route of routes) {
      expect(route.points[1].x).toBeGreaterThan(204);
      expect(route.points[1].x).toBeLessThan(216);
      expect(route.points.at(-1)).toEqual({ x: 380, y: 330 });
    }
  });
  it('places or omits labels after routing, without changing even one path coordinate', () => {
    const source = anchor('tuesday', 223, 272, 200),
      target = anchor('tuesday', 291, 348, 400);
    const route = routeConnection(source, target, columns, canvas, track)!;
    const d = route.d;
    const bounds = { left: 64, right: 520, top: 0, bottom: 600 };
    const short = placeConnectionLabel(route, 90, bounds, [source.rect, target.rect], []);
    expect(short).not.toBeNull();
    expect(placeConnectionLabel(route, 900, bounds, [source.rect, target.rect], [])).toBeNull();
    expect(routeConnection(source, target, columns, canvas, track)?.d).toBe(d);
    expect(route.d).toBe(d);
    expect(
      placeConnectionLabel(route, 90, bounds, [{ left: 64, right: 520, top: 0, height: 600 }], [])
    ).toBeNull();
  });
  it('keeps exact midnight / preview anchors and the trailing-rail consumer marker', () => {
    const route = routeConnection(
      { ...anchor('wednesday', 380, 498, 54), y: 54 },
      { ...anchor('wednesday', 379, 497, 1400), y: 1494 },
      columns,
      canvas
    )!;
    expect(route.d).toBe('M498,54 H514 V1494 H497');
    expect(route.points.at(-1)).toEqual({ x: 497, y: 1494 });
    expect(
      routeConnection(anchor('outside', 0, 10, 54), anchor('monday', 75, 190, 54), columns, canvas)
    ).toBeNull();
  });
});
