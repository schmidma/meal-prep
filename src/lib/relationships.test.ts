import { describe, expect, it } from 'vitest';
import type { Activity, Allocation, Batch } from './domain';
import type { KitchenPlan } from './kitchen';
import {
  addBatchAssignment,
  addIngredientAssignment,
  patchIngredientUseAmount,
  kitchenFocus,
  patchAllocationAmount,
  rangeForTarget,
  warningTargets
} from './relationships';
import { groupFoodConnections } from './view';

const activity = (id: string, kind: Activity['kind'] = 'cook'): Activity => ({
  id,
  title: id,
  kind,
  start: { day: '2026-06-01', minute: 600 },
  elapsedMinutes: 60,
  handsOnMinutes: 0,
  requiresHome: false,
  notes: ''
});
const batch = (id: string, producer: string): Batch => ({
  id,
  name: id,
  quantity: 20,
  unit: 'bowls',
  source: { kind: 'activity', activityId: producer }
});
const allocation = (
  id: string,
  batchId: string,
  activityId: string,
  purpose: Allocation['purpose'] = 'eat',
  when: Allocation['when'] = 'start'
): Allocation => ({ id, batchId, activityId, quantity: 0.5, purpose, when });
function fixture(): KitchenPlan {
  return {
    activities: [
      activity('base'),
      activity('cook'),
      activity('otherCook'),
      activity('sideCook'),
      activity('meal', 'meal'),
      activity('sibling', 'meal'),
      activity('nextCook')
    ],
    batches: [
      batch('stock', 'base'),
      batch('main', 'cook'),
      batch('sauce', 'cook'),
      batch('side', 'sideCook'),
      batch('next', 'nextCook')
    ],
    allocations: [
      allocation('prepared-input', 'stock', 'cook', 'ingredient'),
      allocation('main-meal', 'main', 'meal'),
      allocation('parallel-end', 'main', 'meal', 'eat', 'end'),
      allocation('parallel-ingredient', 'main', 'meal', 'ingredient'),
      allocation('main-sibling', 'main', 'sibling'),
      allocation('sauce-sibling', 'sauce', 'sibling'),
      allocation('co-consumed', 'side', 'meal'),
      allocation('chain', 'sauce', 'nextCook', 'ingredient'),
      allocation('self', 'main', 'cook', 'eat', 'end')
    ],
    ingredients: [{ id: 'raw', name: 'Shared raw stock', quantity: 5, unit: 'g' }],
    ingredientUses: [
      { id: 'raw-cook', ingredientId: 'raw', activityId: 'cook', quantity: 1 },
      { id: 'raw-other', ingredientId: 'raw', activityId: 'otherCook', quantity: 1 }
    ],
    activityRequirements: [
      { id: 'need', activityId: 'cook', name: 'Shared raw stock', quantity: 2 }
    ],
    blockers: [
      {
        id: 'block',
        title: 'Away',
        start: { day: '2026-06-01', minute: 600 },
        durationMinutes: 60,
        away: true
      }
    ],
    availability: {},
    recipes: []
  };
}
const sorted = (items: Set<string>) => [...items].sort();

describe('direct kitchen focus', () => {
  it('meal includes only its foods and producers, not sibling consumers or upstream stock', () => {
    const focus = kitchenFocus(fixture(), { kind: 'activity', id: 'meal' });
    expect(sorted(focus.entityIds)).toEqual(['cook', 'main', 'meal', 'side', 'sideCook']);
    expect(sorted(focus.allocationIds)).toEqual([
      'co-consumed',
      'main-meal',
      'parallel-end',
      'parallel-ingredient'
    ]);
    expect(focus.ingredientUseIds.size).toBe(0);
  });
  it('cook includes own raw inputs, prepared source, both outputs and consumers without traversal', () => {
    const focus = kitchenFocus(fixture(), { kind: 'activity', id: 'cook' });
    expect(sorted(focus.entityIds)).toEqual([
      'base',
      'cook',
      'main',
      'meal',
      'nextCook',
      'raw',
      'sauce',
      'sibling',
      'stock'
    ]);
    expect(sorted(focus.ingredientUseIds)).toEqual(['raw-cook']);
    expect(sorted(focus.allocationIds)).toEqual([
      'chain',
      'main-meal',
      'main-sibling',
      'parallel-end',
      'parallel-ingredient',
      'prepared-input',
      'sauce-sibling',
      'self'
    ]);
    expect(
      groupFoodConnections(fixture(), focus.allocationIds).flatMap((group) =>
        group.parts.map((part) => part.id)
      )
    ).not.toContain('self');
  });
  it('ingredient only shows its users and batch only shows its producer and consumers', () => {
    const plan = fixture();
    const raw = kitchenFocus(plan, { kind: 'ingredient', id: 'raw' });
    expect(sorted(raw.entityIds)).toEqual(['cook', 'otherCook', 'raw']);
    expect(raw.allocationIds.size).toBe(0);
    expect(sorted(kitchenFocus(plan, { kind: 'batch', id: 'main' }).entityIds)).toEqual([
      'cook',
      'main',
      'meal',
      'sibling'
    ]);
    expect(sorted(kitchenFocus(plan, { kind: 'block', id: 'block' }).entityIds)).toEqual(['block']);
    expect(kitchenFocus(plan).entityIds.size).toBe(0);
  });
  it('row selection overrides root and isolates exact parallel allocation or raw use', () => {
    const plan = fixture();
    const focus = kitchenFocus(
      plan,
      { kind: 'activity', id: 'cook' },
      { allocationIds: ['parallel-end'], ingredientUseIds: [] }
    );
    expect(sorted(focus.entityIds)).toEqual(['cook', 'main', 'meal']);
    expect(sorted(focus.allocationIds)).toEqual(['parallel-end']);
    const raw = kitchenFocus(plan, undefined, {
      allocationIds: [],
      ingredientUseIds: ['raw-other']
    });
    expect(sorted(raw.entityIds)).toEqual(['otherCook', 'raw']);
    expect(
      kitchenFocus(plan, undefined, { allocationIds: ['deleted'], ingredientUseIds: [] }).entityIds
        .size
    ).toBe(0);
  });
});

describe('raw use identity', () => {
  it('adds, edits and removes one ID without dropping parallel uses or changing prepared metadata', () => {
    const plan = fixture();
    plan.ingredientUses.push({
      id: 'parallel-raw',
      ingredientId: 'raw',
      activityId: 'cook',
      quantity: 2
    });
    const added = addIngredientAssignment(plan, 'raw', 'cook', 0.5, () => 'unused');
    expect(added.ingredientUses).toEqual(
      plan.ingredientUses.map((use) => (use.id === 'raw-cook' ? { ...use, quantity: 1.5 } : use))
    );
    expect(
      added.ingredientUses
        .filter((use) => use.activityId === 'cook')
        .reduce((sum, use) => sum + use.quantity, 0)
    ).toBe(3.5);
    const edited = patchIngredientUseAmount(added, 'parallel-raw', 4);
    expect(edited.ingredientUses.find((use) => use.id === 'raw-cook')?.quantity).toBe(1.5);
    const removed = patchIngredientUseAmount(edited, 'raw-cook', 0);
    expect(removed.ingredientUses).toEqual(
      edited.ingredientUses.filter((use) => use.id !== 'raw-cook')
    );
    expect(removed.allocations).toEqual(plan.allocations);
    expect(plan.ingredientUses.at(-1)?.quantity).toBe(2);
    expect(
      addIngredientAssignment(removed, 'raw', 'meal', 0.25, () => 'new').ingredientUses.at(-1)
    ).toEqual({ id: 'new', ingredientId: 'raw', activityId: 'meal', quantity: 0.25 });
  });
  it('rejects invalid quantities and missing assignment endpoints', () => {
    for (const amount of [-1, NaN, Infinity])
      expect(() => patchIngredientUseAmount(fixture(), 'raw-cook', amount)).toThrow();
    for (const amount of [0, -1, NaN, Infinity])
      expect(() =>
        addIngredientAssignment(fixture(), 'raw', 'cook', amount, () => 'new')
      ).toThrow();
    expect(() => addIngredientAssignment(fixture(), 'missing', 'cook', 1, () => 'new')).toThrow();
  });
});

describe('allocation identity', () => {
  it('edits/removes only one ID, retaining array order, purpose, timing, IDs and fractions', () => {
    const plan = fixture();
    const edited = patchAllocationAmount(plan, 'parallel-end', 1.25);
    expect(edited.allocations).toEqual(
      plan.allocations.map((item) =>
        item.id === 'parallel-end' ? { ...item, quantity: 1.25 } : item
      )
    );
    expect(patchAllocationAmount(edited, 'main-meal', 0).allocations).toEqual(
      edited.allocations.filter((item) => item.id !== 'main-meal')
    );
    expect(plan.allocations[2].quantity).toBe(0.5);
  });
  it('increments only first matching default, never sums parallel records', () => {
    const plan = fixture();
    plan.allocations.push(allocation('another-default', 'main', 'meal'));
    const next = addBatchAssignment(plan, 'main', 'meal', 1.25, () => 'new');
    expect(next.allocations).toEqual(
      plan.allocations.map((item) => (item.id === 'main-meal' ? { ...item, quantity: 1.75 } : item))
    );
  });
  it('appends when defaults do not match, uses ingredient/start for cooks and eat/end for own output', () => {
    let plan = fixture();
    plan = addBatchAssignment(plan, 'main', 'otherCook', 1.25, () => 'new-cook');
    expect(plan.allocations.at(-1)).toEqual({
      ...allocation('new-cook', 'main', 'otherCook', 'ingredient'),
      quantity: 1.25
    });
    plan = addBatchAssignment(plan, 'main', 'cook', 1, () => 'unused');
    expect(plan.allocations.find((item) => item.id === 'self')?.quantity).toBe(1.5);
    const removed = patchAllocationAmount(plan, 'main-meal', 0);
    const appended = addBatchAssignment(removed, 'main', 'meal', 2, () => 'new-meal');
    expect(appended.allocations.slice(0, -1)).toEqual(removed.allocations);
    expect(appended.allocations.at(-1)).toEqual({
      ...allocation('new-meal', 'main', 'meal'),
      quantity: 2
    });
  });
  it('rejects invalid assignment and editing quantities', () => {
    for (const amount of [-1, NaN, Infinity])
      expect(() => patchAllocationAmount(fixture(), 'self', amount)).toThrow();
    for (const amount of [0, -1, NaN, Infinity])
      expect(() => addBatchAssignment(fixture(), 'main', 'meal', amount, () => 'new')).toThrow();
  });
});

describe('warning and date navigation targets', () => {
  it('resolves allocations, uses, foods and blockers with entity deduplication', () => {
    const targets = warningTargets(fixture(), {
      code: 'CHECK',
      entityIds: ['main-meal', 'main', 'meal', 'raw-other', 'raw', 'block', 'missing'],
      message: ''
    });
    expect(targets.map((item) => item.entity.id)).toEqual([
      'meal',
      'main',
      'otherCook',
      'raw',
      'block'
    ]);
  });
  it('BEFORE_READY targets consumption and overnight readiness rather than just session start', () => {
    const plan = fixture();
    plan.activities[1].start = { day: '2026-06-01', minute: 1410 };
    const targets = warningTargets(plan, {
      code: 'BEFORE_READY',
      entityIds: ['parallel-end', 'main', 'meal'],
      message: ''
    });
    expect(targets.find((item) => item.entity.id === 'cook')?.at).toEqual({
      day: '2026-06-02',
      minute: 30
    });
    expect(targets.find((item) => item.entity.id === 'main')?.at).toEqual({
      day: '2026-06-02',
      minute: 30
    });
    expect(targets.find((item) => item.entity.id === 'meal')?.at).toEqual({
      day: '2026-06-01',
      minute: 660
    });
  });
  it('keeps an existing visible range, otherwise clamps at calendar boundaries', () => {
    expect(rangeForTarget('2026-06-01', 7, '2026-06-04')).toBe('2026-06-01');
    expect(rangeForTarget('2026-06-01', 7, '2026-07-04')).toBe('2026-07-04');
    expect(rangeForTarget('2026-06-01', 7, '9999-12-31')).toBe('9999-12-25');
    expect(rangeForTarget('2026-06-01', 7, '0001-01-01')).toBe('0001-01-01');
  });
});
