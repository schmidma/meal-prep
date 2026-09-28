import { describe, expect, it } from 'vitest';
import { MAX_ACTIVITY_MINUTES } from './domain';
import { createKitchenPlan, type Recipe } from './kitchen';
import { parseKitchenPlan } from './plan-document';
import { createRecipe, instantiateRecipe } from './recipes';

const recipe = (): Recipe => ({
  ...createRecipe('soup', 'Carrot soup'),
  ingredients: [
    { id: 'carrots', name: 'Carrots', quantity: 6 },
    { id: 'stock', name: 'Stock', quantity: 0.5 }
  ],
  instructions: 'Chop.\nSimmer.'
});
const options = () => ({
  activityId: 'make-soup',
  batchId: 'soup-output',
  start: { day: '2026-06-01', minute: 600 },
  title: 'Lunch soup',
  durationMinutes: 60,
  yieldQuantity: 2
});
const ids = () => {
  let next = 0;
  return () => `requirement-${next++}`;
};

describe('recipe templates', () => {
  it('creates an empty, independent template with numeric defaults', () => {
    expect(createRecipe('r', 'Soup')).toEqual({
      id: 'r',
      name: 'Soup',
      yieldQuantity: 4,
      durationMinutes: 45,
      ingredients: [],
      instructions: ''
    });
    const first = createRecipe('r', 'Soup');
    const second = createRecipe('r2', 'Soup');
    first.ingredients.push({ id: 'ing', name: 'Carrots', quantity: 1 });
    expect(second.ingredients).toEqual([]);
    for (const [id, name] of [
      ['', 'Soup'],
      ['r', '  '],
      ['r', 'x'.repeat(10_001)]
    ])
      expect(() => createRecipe(id, name)).toThrow();
  });

  it('instantiates a cook, an output and scaled needs without changing actual stock or links', () => {
    const template = recipe();
    const before = structuredClone(template);
    const chosen = options();
    const result = instantiateRecipe(template, chosen, ids());
    expect(result).toEqual({
      activity: {
        id: 'make-soup',
        title: 'Lunch soup',
        kind: 'cook',
        start: chosen.start,
        elapsedMinutes: 60,
        handsOnMinutes: 0,
        requiresHome: false,
        notes: 'Chop.\nSimmer.'
      },
      batch: {
        id: 'soup-output',
        name: 'Carrot soup',
        quantity: 2,
        unit: '',
        source: { kind: 'activity', activityId: 'make-soup' }
      },
      requirements: [
        { id: 'requirement-0', activityId: 'make-soup', name: 'Carrots', quantity: 3 },
        { id: 'requirement-1', activityId: 'make-soup', name: 'Stock', quantity: 0.25 }
      ]
    });
    expect(template).toEqual(before);
    const plan = createKitchenPlan('2026-06-01');
    const original = structuredClone(plan);
    plan.recipes.push(template);
    plan.activities.push(result.activity);
    plan.batches.push(result.batch);
    plan.activityRequirements.push(...result.requirements);
    expect(parseKitchenPlan(plan)).toEqual(plan);
    expect(plan.ingredients).toEqual(original.ingredients);
    expect(plan.ingredientUses).toEqual(original.ingredientUses);
    expect(plan.allocations).toEqual(original.allocations);
  });

  it('keeps template, time, scheduled copies, and later output edits independent', () => {
    const template = recipe();
    const chosen = options();
    const first = instantiateRecipe(template, chosen, ids());
    const second = instantiateRecipe(
      template,
      { ...chosen, activityId: 'second', batchId: 'second-output' },
      ids()
    );
    template.name = 'New soup';
    template.instructions = 'New instructions';
    template.ingredients[0].name = 'Onions';
    template.ingredients[0].quantity = 99;
    chosen.start.minute = 700;
    first.requirements[0].quantity = 10;
    first.batch.quantity = 20;
    first.activity.notes = 'My variation';
    expect(second.activity.notes).toBe('Chop.\nSimmer.');
    expect(second.activity.start.minute).toBe(600);
    expect(first.activity.start.minute).toBe(600);
    expect(first.requirements[1].quantity).toBe(0.25);
    expect(second.requirements[0]).toMatchObject({ name: 'Carrots', quantity: 3 });
    expect(first.batch.name).toBe('Carrot soup');
    expect(second.batch.quantity).toBe(2);
    expect(template.ingredients[0].quantity).toBe(99);
  });

  it('rejects invalid choices, dates, names, quantities and generated IDs instead of clamping', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      expect(() =>
        instantiateRecipe(recipe(), { ...options(), yieldQuantity: value }, ids())
      ).toThrow();
      expect(() =>
        instantiateRecipe({ ...recipe(), yieldQuantity: value }, options(), ids())
      ).toThrow();
    }
    for (const durationMinutes of [-1, 0.5, Infinity, MAX_ACTIVITY_MINUTES + 1])
      expect(() => instantiateRecipe(recipe(), { ...options(), durationMinutes }, ids())).toThrow();
    for (const start of [
      { day: '2026-02-30', minute: 0 },
      { day: '2026-06-01', minute: 1440 },
      { day: '9999-12-31', minute: 1439 }
    ])
      expect(() => instantiateRecipe(recipe(), { ...options(), start }, ids())).toThrow();
    expect(() => instantiateRecipe(recipe(), { ...options(), title: ' ' }, ids())).toThrow();
    expect(() => instantiateRecipe({ ...recipe(), name: '' }, options(), ids())).toThrow();
    expect(() => instantiateRecipe(recipe(), options(), () => 'duplicate')).toThrow();
    expect(() => instantiateRecipe(recipe(), options(), () => 'carrots')).toThrow();
    expect(() =>
      instantiateRecipe(recipe(), { ...options(), batchId: 'make-soup' }, ids())
    ).toThrow();
    expect(
      instantiateRecipe(recipe(), { ...options(), durationMinutes: 0 }, ids()).activity
        .elapsedMinutes
    ).toBe(0);
  });

  it('rejects overflow and underflow in scaling and retains valid fractional quantities', () => {
    const large = recipe();
    large.ingredients[0].quantity = Number.MAX_VALUE;
    expect(() => instantiateRecipe(large, { ...options(), yieldQuantity: 8 }, ids())).toThrow();
    const tiny = recipe();
    tiny.ingredients[0].quantity = Number.MIN_VALUE;
    expect(() => instantiateRecipe(tiny, options(), ids())).toThrow();
    expect(() =>
      instantiateRecipe({ ...recipe(), yieldQuantity: Number.MIN_VALUE }, options(), ids())
    ).toThrow();
    expect(() =>
      instantiateRecipe(
        { ...recipe(), yieldQuantity: Number.MAX_VALUE },
        { ...options(), yieldQuantity: Number.MIN_VALUE },
        ids()
      )
    ).toThrow();
    expect(
      instantiateRecipe(recipe(), { ...options(), yieldQuantity: 1 }, ids()).requirements[0]
        .quantity
    ).toBe(1.5);
  });
});
