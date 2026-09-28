import { describe, expect, it } from 'vitest';
import {
  connectedKitchenIds,
  createKitchenPlan,
  deleteActivity,
  deleteBlocker,
  deleteIngredient,
  ingredientTotals,
  moveActivity,
  moveBlocker,
  parseIngredient,
  parsePreparedFood,
  setIngredientUse,
  validateKitchenPlan,
  type KitchenPlan
} from './kitchen';
import { batchTotals } from './domain';

const seed = () => createKitchenPlan('2026-06-01');
const codes = (plan: KitchenPlan) => validateKitchenPlan(plan).map((warning) => warning.code);

describe('food parsing', () => {
  it('uses a whole numeric token as quantity and treats remaining words as a literal name', () => {
    for (const parse of [parseIngredient, parsePreparedFood]) {
      expect(parse('2 paprika')).toEqual({ name: 'paprika', quantity: 2, unit: '' });
      expect(parse('0,5 cabbage')).toEqual({ name: 'cabbage', quantity: 0.5, unit: '' });
      expect(parse('200g spinach')).toEqual({ name: '200g spinach', quantity: 1, unit: '' });
      expect(parse('2 jars beans')).toEqual({ name: 'jars beans', quantity: 2, unit: '' });
      expect(parse('2 portions of curry')).toEqual({
        name: 'portions of curry',
        quantity: 2,
        unit: ''
      });
      expect(parse('cake')).toEqual({ name: 'cake', quantity: 1, unit: '' });
      expect(parse('Nando sauce')).toEqual({ name: 'Nando sauce', quantity: 1, unit: '' });
      expect(parse('Nantucket cranberries')).toEqual({
        name: 'Nantucket cranberries',
        quantity: 1,
        unit: ''
      });
    }
  });
  it('rejects empty, missing food, and invalid quantities', () => {
    for (const text of [
      '',
      ' ',
      '0 paprika',
      '-2 paprika',
      'Infinity paprika',
      'NaN paprika',
      '1e309 paprika',
      '2',
      '-2',
      'Infinity',
      'NaN'
    ])
      expect(() => parseIngredient(text)).toThrow(Error);
    for (const text of ['', '0 cake', 'Infinity cake', '2'])
      expect(() => parsePreparedFood(text)).toThrow(Error);
  });
});

describe('allocations and graph', () => {
  it('retains partial and excessive use regardless of display dates', () => {
    const original = seed();
    const partial = setIngredientUse(original, 'ing-paprika', 'cook-curry', 1);
    expect(original.ingredientUses).toHaveLength(0);
    expect(ingredientTotals(partial, 'ing-paprika')).toEqual({
      available: 2,
      assigned: 1,
      remaining: 1
    });
    const extra = setIngredientUse(partial, 'ing-paprika', 'lunch-tue', 2);
    expect(ingredientTotals(extra, 'ing-paprika').remaining).toBe(-1);
    expect(
      validateKitchenPlan(extra).find((warning) => warning.code === 'OVER_ALLOCATED_INGREDIENT')
        ?.entityIds
    ).toEqual(expect.arrayContaining(['ing-paprika', 'cook-curry', 'lunch-tue']));
    const replaced = setIngredientUse(extra, 'ing-paprika', 'cook-curry', 3);
    expect(replaced.ingredientUses.find((use) => use.activityId === 'cook-curry')?.id).toBe(
      partial.ingredientUses[0].id
    );
    expect(replaced.ingredientUses).toHaveLength(2);
    expect(
      ingredientTotals(setIngredientUse(replaced, 'ing-paprika', 'lunch-tue', 0), 'ing-paprika')
        .assigned
    ).toBe(3);
    expect(() => setIngredientUse(original, 'missing', 'cook-curry', 1)).toThrow();
    expect(() => setIngredientUse(original, 'ing-paprika', 'missing', 1)).toThrow();
    for (const bad of [-1, Infinity, NaN])
      expect(() => setIngredientUse(original, 'ing-paprika', 'cook-curry', bad)).toThrow();
  });
  it('moves without breaking raw or batch links, deletes with cascades', () => {
    const plan = setIngredientUse(seed(), 'ing-paprika', 'cook-curry', 2);
    const moved = moveActivity(plan, 'cook-curry', { day: '2026-06-09', minute: 1300 });
    expect(moved.activities.find((activity) => activity.id === 'cook-curry')?.id).toBe(
      'cook-curry'
    );
    expect(moved.ingredientUses).toEqual(plan.ingredientUses);
    expect(moved.allocations).toEqual(plan.allocations);
    for (const id of ['ing-paprika', 'cook-curry', 'curry', 'lunch-tue'])
      expect(connectedKitchenIds(moved, 'ing-paprika').has(id)).toBe(true);
    expect(connectedKitchenIds(moved, 'curry').has('ing-paprika')).toBe(true);
    const deleted = deleteActivity(moved, 'cook-curry');
    expect(deleted.ingredientUses).toHaveLength(0);
    expect(deleted.batches.some((batch) => batch.id === 'curry')).toBe(false);
    expect(batchTotals(deleted, 'curry').assigned).toBe(0);
    expect(ingredientTotals(deleted, 'ing-paprika').remaining).toBe(2);
    expect(deleteIngredient(plan, 'ing-paprika').ingredientUses).toHaveLength(0);
  });
  it('keeps recipe needs separate from stock links and cleans up only a deleted activity', () => {
    const plan = seed();
    expect(plan.recipes).toEqual([]);
    expect(plan.activityRequirements).toEqual([]);
    plan.recipes.push({
      id: 'recipe',
      name: 'Soup',
      yieldQuantity: 4,
      durationMinutes: 45,
      ingredients: [{ id: 'template-ingredient', name: 'Paprika', quantity: 2 }],
      instructions: 'Cook.'
    });
    plan.activityRequirements.push(
      { id: 'need', activityId: 'cook-curry', name: 'Paprika', quantity: 2 },
      { id: 'other-need', activityId: 'lunch-tue', name: 'Paprika', quantity: 1 }
    );
    expect(connectedKitchenIds(plan, 'ing-paprika')).toEqual(new Set(['ing-paprika']));
    expect(connectedKitchenIds(plan, 'cook-curry').has('need')).toBe(false);
    expect(ingredientTotals(plan, 'ing-paprika')).toEqual({
      available: 2,
      assigned: 0,
      remaining: 2
    });
    expect(deleteIngredient(plan, 'ing-paprika').activityRequirements).toEqual(
      plan.activityRequirements
    );
    const moved = moveActivity(plan, 'cook-curry', { day: '2026-06-09', minute: 600 });
    expect(moved.recipes).toEqual(plan.recipes);
    expect(moved.activityRequirements).toEqual(plan.activityRequirements);
    const deleted = deleteActivity(moved, 'cook-curry');
    expect(deleted.recipes).toEqual(plan.recipes);
    expect(deleted.activityRequirements).toEqual([plan.activityRequirements[1]]);
    expect(deleted.ingredients).toEqual(plan.ingredients);
    expect(plan.activityRequirements).toHaveLength(2);
    const noBlocker = deleteBlocker(plan, plan.blockers[0].id);
    expect(noBlocker.recipes).toEqual(plan.recipes);
    expect(noBlocker.activityRequirements).toEqual(plan.activityRequirements);
  });
  it('validates malformed raw references and quantities without throwing', () => {
    const plan = seed();
    plan.ingredients[0].quantity = -1;
    plan.ingredientUses.push({
      id: 'invalid',
      ingredientId: 'missing',
      activityId: 'missing',
      quantity: NaN
    });
    expect(codes(plan)).toEqual(
      expect.arrayContaining([
        'INVALID_INGREDIENT',
        'INVALID_QUANTITY',
        'MISSING_INGREDIENT',
        'MISSING_ACTIVITY'
      ])
    );
  });
});

describe('timed blockers', () => {
  it('seeds real windows, allows resizing/moving and deletion', () => {
    const plan = seed();
    expect(plan.availability).toEqual({});
    expect(plan.blockers[0]).toMatchObject({
      id: 'block-climbing',
      start: { day: '2026-06-02', minute: 1080 },
      durationMinutes: 180,
      away: false
    });
    expect(
      plan.activities.every((activity) => activity.handsOnMinutes === 0 && !activity.requiresHome)
    ).toBe(true);
    expect(plan.batches.every((batch) => batch.unit === '')).toBe(true);
    expect(plan.ingredients.every((ingredient) => ingredient.unit === '')).toBe(true);
    expect(plan.blockers.every((blocker) => !blocker.away)).toBe(true);
    const moved = moveBlocker(plan, 'block-climbing', { day: '2026-06-09', minute: 1380 }, 120);
    expect(moved.blockers[0].durationMinutes).toBe(120);
    expect(plan.blockers[0].durationMinutes).toBe(180);
    expect(deleteBlocker(moved, 'block-climbing').blockers).toHaveLength(1);
    expect(() => moveBlocker(plan, 'block-climbing', { day: 'invalid', minute: 0 })).toThrow();
    expect(() =>
      moveBlocker(plan, 'block-climbing', { day: '2026-06-09', minute: 0 }, 0)
    ).toThrow();
    expect(() => moveActivity(plan, 'cook-curry', { day: '2026-02-30', minute: 10 })).toThrow();
  });
  it('reports every blocker intersecting an entire activity span, regardless of legacy fields', () => {
    const plan = seed();
    plan.activities = [
      {
        id: 'night',
        title: 'Night',
        kind: 'other',
        start: { day: '2026-06-02', minute: 1320 },
        elapsedMinutes: 180,
        handsOnMinutes: 0,
        requiresHome: false,
        notes: ''
      }
    ];
    plan.batches = [];
    plan.allocations = [];
    plan.blockers = [
      {
        id: 'a',
        title: 'A',
        start: { day: '2026-06-02', minute: 1380 },
        durationMinutes: 120,
        away: false
      },
      {
        id: 'b',
        title: 'B',
        start: { day: '2026-06-03', minute: 0 },
        durationMinutes: 60,
        away: true
      },
      {
        id: 'touch',
        title: 'Touch',
        start: { day: '2026-06-03', minute: 60 },
        durationMinutes: 60,
        away: true
      }
    ];
    plan.availability = { '2026-06-02': { label: 'away', cookable: [], atHome: [] } };
    const before = structuredClone(plan);
    expect(validateKitchenPlan(plan).filter((warning) => warning.code === 'BLOCKED_TIME')).toEqual([
      {
        code: 'BLOCKED_TIME',
        entityIds: ['night', 'a'],
        message: 'Night overlaps blocked time A.'
      },
      { code: 'BLOCKED_TIME', entityIds: ['night', 'b'], message: 'Night overlaps blocked time B.' }
    ]);
    expect(plan).toEqual(before);
    plan.activities[0].handsOnMinutes = 200;
    plan.activities[0].requiresHome = true;
    plan.blockers[0].away = true;
    expect(codes(plan).filter((code) => code === 'BLOCKED_TIME')).toHaveLength(2);
    plan.activities[0].elapsedMinutes = 0;
    expect(codes(plan)).not.toContain('BLOCKED_TIME');
  });
  it('reports invalid dates and extreme durations without throwing', () => {
    const plan = seed();
    plan.blockers = [
      {
        id: 'zero',
        title: 'Zero length',
        start: { day: '2026-06-01', minute: 0 },
        durationMinutes: 0,
        away: false
      },
      {
        id: 'bad-day',
        title: 'Bad date',
        start: { day: '2026-02-30', minute: 0 },
        durationMinutes: 10,
        away: true
      },
      {
        id: 'huge',
        title: 'Too long',
        start: { day: '2026-06-01', minute: 0 },
        durationMinutes: Number.MAX_SAFE_INTEGER,
        away: true
      },
      {
        id: 'end',
        title: 'End of calendar',
        start: { day: '9999-12-31', minute: 1439 },
        durationMinutes: 2,
        away: true
      }
    ];
    expect(() => validateKitchenPlan(plan)).not.toThrow();
    expect(codes(plan).filter((code) => code === 'INVALID_BLOCKER')).toHaveLength(4);
  });
});
