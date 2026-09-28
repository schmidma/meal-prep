import { describe, expect, it } from 'vitest';
import { createExamplePlan } from './example-plan';
import {
  activityEnd,
  activityIssues,
  allocationAt,
  batchReadyAt,
  batchTotals,
  connectedIds,
  removeActivity,
  removeBatch,
  validatePlan
} from './domain';
import type { Activity, Allocation, Batch, Plan } from './domain';

const day = '2025-06-02';
const time = (minute: number, on = day) => ({ day: on, minute });
const activity = (
  id: string,
  minute: number,
  elapsedMinutes = 60,
  handsOnMinutes = 10
): Activity => ({
  id,
  title: id,
  kind: 'cook',
  start: time(minute),
  elapsedMinutes,
  handsOnMinutes,
  requiresHome: false,
  notes: ''
});
const batch = (id: string, activityId: string, quantity = 4): Batch => ({
  id,
  name: id,
  quantity,
  unit: 'portions',
  source: { kind: 'activity', activityId }
});
const allocation = (
  id: string,
  batchId: string,
  activityId: string,
  quantity: number,
  purpose: Allocation['purpose'] = 'eat',
  when: Allocation['when'] = 'start'
): Allocation => ({ id, batchId, activityId, quantity, purpose, when });
const plan = (
  activities: Activity[],
  batches: Batch[] = [],
  allocations: Allocation[] = []
): Plan => ({ activities, batches, allocations, availability: {} });
const codes = (p: Plan) => validatePlan(p).map((warning) => warning.code);

describe('planning graph and quantities', () => {
  it('accounts for fractional allocations across all dates and keeps negative remaining', () => {
    const p = plan(
      [activity('make', 600), activity('later', 800)],
      [batch('out', 'make', 1.25)],
      [allocation('a', 'out', 'later', 0.5), allocation('b', 'out', 'later', 1)]
    );
    expect(batchTotals(p, 'out')).toEqual({ produced: 1.25, assigned: 1.5, remaining: -0.25 });
    expect(codes(p)).toContain('OVER_ALLOCATED');
    p.activities[1].start = time(800, '2025-07-01');
    expect(batchTotals(p, 'out').assigned).toBe(1.5);
  });
  it('traverses multiple input and output batches from activities or existing-batch roots', () => {
    const p = plan(
      [activity('a', 600), activity('b', 800), activity('c', 1000)],
      [
        batch('first', 'a'),
        batch('second', 'a'),
        batch('third', 'b'),
        {
          id: 'shelf',
          name: 'Shelf',
          quantity: 2,
          unit: 'cups',
          source: { kind: 'existing', availableAt: time(0) }
        }
      ],
      [
        allocation('x', 'first', 'b', 1, 'ingredient'),
        allocation('y', 'shelf', 'b', 1, 'ingredient'),
        allocation('z', 'third', 'c', 1, 'ingredient')
      ]
    );
    expect(connectedIds(p, 'a')).toEqual(
      new Set(['a', 'first', 'second', 'b', 'shelf', 'third', 'c'])
    );
    expect(connectedIds(p, 'shelf')).toEqual(
      new Set(['shelf', 'b', 'first', 'third', 'a', 'c', 'second'])
    );
    expect(codes(p)).toEqual([]);
  });
  it('allows exact readiness and eating an output at the end of its own session', () => {
    const p = plan(
      [activity('maker', 600), activity('consumer', 660)],
      [batch('food', 'maker')],
      [
        allocation('same', 'food', 'maker', 1, 'eat', 'end'),
        allocation('equal', 'food', 'consumer', 1)
      ]
    );
    expect(activityEnd(p.activities[0])).toEqual(time(660));
    expect(batchReadyAt(p, p.batches[0])).toEqual(time(660));
    expect(allocationAt(p, p.allocations[0])).toEqual(time(660));
    expect(codes(p)).not.toContain('BEFORE_READY');
    expect(codes(p)).not.toContain('POSSIBLE_OVERLAP');
    p.allocations.push(allocation('own-input', 'food', 'maker', 1, 'ingredient', 'end'));
    expect(codes(p)).toContain('OWN_INGREDIENT');
  });
  it('detects dependency cycles and dangling references without throwing', () => {
    const p = plan(
      [activity('a', 600), activity('b', 700)],
      [batch('a-out', 'a'), batch('b-out', 'b'), batch('lost', 'missing')],
      [
        allocation('a-to-b', 'a-out', 'b', 1, 'ingredient'),
        allocation('b-to-a', 'b-out', 'a', 1, 'ingredient'),
        allocation('no-batch', 'absent', 'a', 1),
        allocation('no-activity', 'a-out', 'absent', 1)
      ]
    );
    expect(codes(p)).toContain('INGREDIENT_CYCLE');
    expect(codes(p)).toContain('MISSING_ACTIVITY');
    expect(codes(p)).toContain('MISSING_BATCH');
    expect(batchReadyAt(p, p.batches[2])).toBeUndefined();
    expect(allocationAt(p, p.allocations[3])).toBeUndefined();
  });
  it('flags producer moved past the consumption time', () => {
    const p = plan(
      [activity('make', 600), activity('eat', 800, 30, 0)],
      [batch('food', 'make')],
      [allocation('serving', 'food', 'eat', 1)]
    );
    expect(codes(p)).toEqual([]);
    p.activities[0].start = time(900);
    expect(codes(p)).toContain('BEFORE_READY');
    expect(activityIssues(p, 'eat').map((issue) => issue.code)).toContain('BEFORE_READY');
  });
  it('deletes dependent graph edges without mutating input', () => {
    const p = plan(
      [activity('make', 600), activity('eat', 800)],
      [batch('food', 'make'), batch('other', 'eat')],
      [
        allocation('food-use', 'food', 'eat', 2),
        allocation('other-use', 'other', 'eat', 1, 'eat', 'end')
      ]
    );
    const removed = removeActivity(p, 'make');
    expect(removed.activities.map((a) => a.id)).toEqual(['eat']);
    expect(removed.batches.map((b) => b.id)).toEqual(['other']);
    expect(removed.allocations.map((a) => a.id)).toEqual(['other-use']);
    expect(removeBatch(p, 'food').allocations.map((a) => a.id)).toEqual(['other-use']);
    expect(p.activities).toHaveLength(2);
    expect(p.batches).toHaveLength(2);
  });
});

describe('advisory validation', () => {
  it('ignores valid legacy effort, home and availability fields without mutating input', () => {
    const p = plan([{ ...activity('long', 600, 120, 200), requiresHome: true }]);
    p.availability[day] = { label: 'away', cookable: [], atHome: [] };
    const before = structuredClone(p);
    expect(codes(p)).toEqual([]);
    expect(p).toEqual(before);
    p.activities[0].handsOnMinutes = 0;
    p.activities[0].requiresHome = false;
    expect(codes(p)).toEqual([]);
  });
  it('checks full elapsed overlap for every kind across midnight, excluding empty and touching spans', () => {
    const p = plan([
      { ...activity('oven', 1410, 90, 0), kind: 'cook' },
      { ...activity('meal', 0, 30, 0), kind: 'meal', start: time(0, '2025-06-03') },
      { ...activity('other', 0, 30, 0), kind: 'other', start: time(30, '2025-06-03') },
      { ...activity('empty', 0, 0, 0), start: time(0, '2025-06-03') },
      { ...activity('touch', 0, 30, 0), start: time(60, '2025-06-03') }
    ]);
    const overlaps = validatePlan(p).filter((warning) => warning.code === 'POSSIBLE_OVERLAP');
    expect(overlaps.map((warning) => warning.entityIds)).toEqual([
      ['oven', 'meal'],
      ['oven', 'other']
    ]);
    expect(overlaps[0].message).toBe('oven and meal overlap.');
  });
  it('reports invalid data and dates instead of crashing', () => {
    const p = plan(
      [activity('a', 600)],
      [batch('b', 'a', -1)],
      [allocation('bad', 'b', 'a', Number.NaN)]
    );
    p.activities[0].start.day = '2025-02-30';
    p.activities[0].elapsedMinutes = Number.POSITIVE_INFINITY;
    p.availability.bad = { label: 'broken', cookable: [{ start: 30, end: 10 }], atHome: [] };
    expect(codes(p)).toEqual(
      expect.arrayContaining(['INVALID_TIME', 'INVALID_QUANTITY', 'INVALID_DAY', 'INVALID_RANGE'])
    );
  });
  it('rejects overflowing ends and extreme draft durations without throwing or expanding them', () => {
    const p = plan(
      [activity('make', 600), activity('eat', 800, 30, 0)],
      [batch('food', 'make')],
      [allocation('serving', 'food', 'eat', 1)]
    );
    p.activities[0].start = time(600, '9999-12-31');
    p.activities[0].elapsedMinutes = 1440;
    expect(() => validatePlan(p)).not.toThrow();
    expect(codes(p)).toContain('INVALID_TIME');
    p.activities[0].start = time(600);
    p.activities[0].elapsedMinutes = Number.MAX_SAFE_INTEGER;
    expect(() => validatePlan(p)).not.toThrow();
    expect(codes(p)).toContain('INVALID_TIME');
  });
  it('seeds a valid week with stable IDs and unallocated portions', () => {
    const p = createExamplePlan('2025-06-02');
    expect(codes(p)).toEqual([]);
    expect(p.activities.find((a) => a.id === 'cook-curry')?.start).toEqual(time(1155));
    expect(p.activities.every((a) => a.kind && a.notes)).toBe(true);
    expect(batchTotals(p, 'stock-veg').remaining).toBe(1);
    expect(batchTotals(p, 'grains').remaining).toBe(2);
    expect(batchTotals(p, 'cake').remaining).toBe(2);
    expect(p.activities.some((a) => a.id === 'stock-veg')).toBe(false);
  });
});
