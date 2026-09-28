import { describe, expect, it } from 'vitest';
import type { Allocation, Batch, Plan } from './domain';
import { displayBalance, groupFoodConnections, quantity } from './view';

const batch = (id: string, sourceId: string): Batch => ({
  id,
  name: id,
  quantity: 5,
  unit: 'portions',
  source: { kind: 'activity', activityId: sourceId }
});
const allocation = (
  id: string,
  batchId: string,
  activityId: string,
  quantity: number
): Allocation => ({ id, batchId, activityId, quantity, purpose: 'eat', when: 'start' });
const plan = (batches: Batch[], allocations: Allocation[]): Plan => ({
  activities: [],
  batches,
  allocations,
  availability: {}
});

describe('displayBalance', () => {
  it('removes only scale-aware floating subtraction noise in displayed balances', () => {
    expect(displayBalance(0.3, 0.1 + 0.2)).toBe(0);
    expect(quantity(displayBalance(0.3, 0.1 + 0.2), 0.3)).toBe('0');
    expect(displayBalance(1e-12, 0)).toBe(1e-12);
    expect(displayBalance(1, 1 + 0.0001)).toBeLessThan(0);
    expect(displayBalance(1, 1 + 0.00000001)).toBeLessThan(0);
    expect(quantity(-displayBalance(1, 1 + 0.00000001), 1)).toBe('0.00000001');
  });
});

describe('quantity', () => {
  it('bounds repeating quantities and marks display rounding without changing ordinary amounts', () => {
    expect(quantity(4 / 3)).toBe('≈1.33333');
    expect(quantity(1 / 3)).toBe('≈0.333333');
    expect([0.25, 4, 5, 1].map((value) => quantity(value))).toEqual(['0.25', '4', '5', '1']);
    expect(quantity(0.1 + 0.2)).toBe('0.3');
  });
  it('keeps clean tiny shortages and standalone stock, using bounded scientific notation as needed', () => {
    expect(quantity(-displayBalance(1, 1.0001), 1)).toBe('0.0001');
    expect(quantity(0.00000001)).toBe('0.00000001');
    expect(quantity(1e-12)).toBe('1e-12');
    expect(quantity(1.23456789e-12)).toBe('≈1.23457e-12');
    expect(quantity(1.23456789e20)).toBe('≈1.23457e+20');
    expect(quantity(Number.MIN_VALUE)).not.toBe('0');
    expect(quantity(Number.MAX_VALUE)).toBe('≈1.79769e+308');
  });
});

describe('groupFoodConnections', () => {
  it('keeps allocation-specific routes in first-seen order with every identity and quantity', () => {
    const input = plan(
      [batch('first', 'a'), batch('second', 'a'), batch('reverse', 'b'), batch('other', 'a')],
      [
        allocation('one', 'first', 'b', 2),
        allocation('reverse-one', 'reverse', 'a', 1),
        allocation('third', 'other', 'c', 4),
        allocation('two', 'second', 'b', 3)
      ]
    );
    expect(groupFoodConnections(input)).toEqual([
      {
        key: 'one',
        sourceId: 'a',
        targetId: 'b',
        parts: [{ ...input.allocations[0], batchName: 'first' }]
      },
      {
        key: 'reverse-one',
        sourceId: 'b',
        targetId: 'a',
        parts: [{ ...input.allocations[1], batchName: 'reverse' }]
      },
      {
        key: 'third',
        sourceId: 'a',
        targetId: 'c',
        parts: [{ ...input.allocations[2], batchName: 'other' }]
      },
      {
        key: 'two',
        sourceId: 'a',
        targetId: 'b',
        parts: [{ ...input.allocations[3], batchName: 'second' }]
      }
    ]);
  });

  it('filters individual allocations before grouping, including parallel records', () => {
    const input = plan(
      [batch('food', 'a')],
      [
        allocation('start', 'food', 'b', 0.5),
        { ...allocation('end', 'food', 'b', 1.5), when: 'end' }
      ]
    );
    expect(groupFoodConnections(input, new Set())).toEqual([]);
    expect(groupFoodConnections(input, new Set(['end']))[0].parts).toEqual([
      { ...input.allocations[1], batchName: 'food' }
    ]);
  });

  it('ignores existing sources, own outputs and missing batches; pair keys cannot collide', () => {
    const input = plan(
      [
        batch('split', 'a,b'),
        batch('single', 'a'),
        {
          id: 'existing',
          name: 'pantry',
          quantity: 5,
          unit: '',
          source: {
            kind: 'existing',
            availableAt: { day: '2025-06-02', minute: 0 }
          }
        }
      ],
      [
        allocation('split', 'split', 'c', 2),
        allocation('single', 'single', 'b,c', 3),
        allocation('own', 'single', 'a', 1),
        allocation('pantry', 'existing', 'c', 1),
        allocation('orphan', 'missing', 'c', 1)
      ]
    );
    const groups = groupFoodConnections(input);
    expect(groups.map((group) => group.key)).toEqual(['split', 'single']);
    expect(groups.map((group) => group.parts)).toEqual([
      [{ ...input.allocations[0], batchName: 'split' }],
      [{ ...input.allocations[1], batchName: 'single' }]
    ]);
  });
});
