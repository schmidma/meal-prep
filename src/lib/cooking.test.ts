import { describe, expect, it } from 'vitest';
import { createPlaygroundPlan } from '../../tests/fixtures/plans';
import { clearWeek, removeCooking, saveCooking, servingSlots, shoppingForBatch } from './cooking';
import { parseKitchenPlan } from './plan-document';
import { addDays } from './calendar';
const week = '2026-09-28';
describe('batch-first weekly planning', () => {
  it('starts each new week empty while retaining recipes and images', () => {
    const plan = createPlaygroundPlan(week);
    const empty = clearWeek(plan, week);
    expect(empty.activities).toHaveLength(0);
    expect(empty.weekly?.sessions).toHaveLength(0);
    expect(empty.recipes).toEqual(plan.recipes);
    expect(empty.weekly?.images?.['recipe-curry']).toBe('chickpea-curry');
    expect(empty.weekly?.shopping).toEqual(plan.weekly?.shopping);
    expect(parseKitchenPlan(empty)).toEqual(empty);
  });
  it('creates and edits multiple meal slots as one reversible snapshot', () => {
    const plan = createPlaygroundPlan(week);
    const session = plan.weekly!.sessions![0];
    const slots = servingSlots(plan, session.id);
    const next = saveCooking(
      plan,
      { ...session, day: addDays(week, 1) },
      [slots[1], { id: 'new-lunch', day: addDays(week, 2), slot: 'Lunch', portions: 2 }],
      'chickpea-curry'
    );
    expect(next.activities.some((a) => a.id === slots[0].id)).toBe(false);
    expect(next.activities.find((a) => a.id === 'new-lunch')?.title).toBe(session.name);
    expect(next.weekly?.images?.['new-lunch']).toBe('chickpea-curry');
    expect(servingSlots(next, session.id)).toHaveLength(2);
    expect(plan.activities.some((a) => a.id === slots[0].id)).toBe(true);
  });
  it('removing a cook preserves its planned meals and recipe snapshots', () => {
    const plan = createPlaygroundPlan(week);
    const session = plan.weekly!.sessions![0];
    const next = removeCooking(plan, session.id);
    expect(next.activities).toEqual(plan.activities);
    expect(next.recipes).toEqual(plan.recipes);
    expect(servingSlots(next, session.id)).toHaveLength(0);
    expect(next.weekly?.images?.['curry-dinner-demo']).toBe('chickpea-curry');
    expect(parseKitchenPlan(next)).toEqual(next);
  });
  it('clearing a week does not delete next week meals', () => {
    const plan = createPlaygroundPlan(week);
    const session = plan.weekly!.sessions![0];
    const next = saveCooking(
      plan,
      session,
      [
        ...servingSlots(plan, session.id),
        { id: 'next-week', day: addDays(week, 7), slot: 'Lunch', portions: 2 }
      ],
      'chickpea-curry'
    );
    const empty = clearWeek(next, week);
    expect(empty.activities.map((a) => a.id)).toEqual(['next-week']);
    expect(empty.weekly?.mealSources?.['next-week']).toBeUndefined();
    expect(parseKitchenPlan(empty)).toEqual(empty);
  });
  it('rejects broken source references and nonlocal photo values', () => {
    const plan = createPlaygroundPlan(week);
    expect(() =>
      parseKitchenPlan({
        ...plan,
        weekly: { ...plan.weekly, mealSources: { bad: { sessionId: 'missing', portions: 2 } } }
      })
    ).toThrow();
    expect(() =>
      parseKitchenPlan({
        ...plan,
        weekly: { ...plan.weekly, images: { bad: 'https://example.com/image.jpg' } }
      })
    ).toThrow();
  });
});

it('scales batch shopping amounts and preserves seasoning and ranges', () => {
  const curry = createPlaygroundPlan(week).recipes[0];
  expect(shoppingForBatch(curry, 6)).toEqual([
    '3 tins chickpeas',
    '1.5 onion',
    '600 ml coconut milk',
    '3 tbsp curry paste',
    '300 g spinach',
    '450 g basmati rice'
  ]);
  const recipe = {
    ...curry,
    ingredients: [
      '1/2 onion',
      '1 1/2 cups rice',
      'Salt to taste',
      '2-3 cloves garlic',
      'Olive oil'
    ].map((name, i) => ({ id: String(i), name, quantity: 1 }))
  };
  expect(shoppingForBatch(recipe, 8)).toEqual([
    '1 onion',
    '3 cups rice',
    'Salt to taste',
    '2-3 cloves garlic',
    'Olive oil'
  ]);
  expect(shoppingForBatch(recipe, 4)).toEqual([
    '1/2 onion',
    '1 1/2 cups rice',
    'Salt to taste',
    '2-3 cloves garlic',
    'Olive oil'
  ]);
});

it('updates only a cook’s shopping contribution without duplicate amounts', () => {
  let plan = clearWeek(createPlaygroundPlan(week), week);
  const recipe = plan.recipes[0];
  const session = {
    id: 'shopping-cook',
    name: recipe.name,
    day: week,
    quantity: 4,
    notes: '',
    recipeId: recipe.id
  };
  plan = saveCooking(plan, session, [], '', shoppingForBatch(recipe, 4));
  const own = plan.weekly!.shopping.filter((item) => item.cookId === session.id);
  plan.weekly!.shopping.find((item) => item.id === own[0].id)!.checked = true;
  plan.weekly!.shopping.push({ id: 'manual-chickpeas', name: '2 tins chickpeas', checked: false });
  plan = saveCooking(plan, { ...session, quantity: 6 }, [], '', shoppingForBatch(recipe, 6));
  expect(plan.weekly!.shopping.filter((item) => item.cookId === session.id)).toHaveLength(6);
  expect(plan.weekly!.shopping.find((item) => item.id === own[0].id)).toMatchObject({
    name: '3 tins chickpeas',
    checked: false
  });
  expect(plan.weekly!.shopping.find((item) => item.id === 'manual-chickpeas')!.name).toBe(
    '2 tins chickpeas'
  );
  plan = removeCooking(plan, session.id);
  expect(plan.weekly!.shopping.every((item) => !item.cookId)).toBe(true);
  expect(parseKitchenPlan(plan)).toEqual(plan);
});

it('scales single-character fractions and mixed fractions while preserving the recipe', () => {
  const recipe = {
    ...createPlaygroundPlan(week).recipes[0],
    yieldQuantity: 2,
    ingredients: ['½ lemon', '1½ cups stock', '2 ¼ tsp spice', '⅓ cup cream'].map((name, i) => ({
      id: String(i),
      name,
      quantity: 1
    }))
  };
  expect(shoppingForBatch(recipe, 8)).toEqual([
    '2 lemon',
    '6 cups stock',
    '9 tsp spice',
    '1.333 cup cream'
  ]);
  expect(shoppingForBatch(recipe, 2)[0]).toBe('½ lemon');
});

it('preserves personal meal and shopping edits when saving or resizing a cook', () => {
  let plan = clearWeek(createPlaygroundPlan(week), week);
  const recipe = plan.recipes[0];
  const session = {
    id: 'personal-cook',
    name: recipe.name,
    day: week,
    quantity: 4,
    notes: 'Original method',
    recipeId: recipe.id
  };
  const slots = [{ id: 'personal-meal', day: week, slot: 'Dinner' as const, portions: 2 }];
  plan = saveCooking(plan, session, slots, 'chickpea-curry', shoppingForBatch(recipe, 4));
  plan.activities[0].title = 'Curry with naan tonight';
  plan.activities[0].notes = 'Add extra chilli';
  plan.weekly!.images!['personal-meal'] = 'lemon-pasta';
  const rows = plan.weekly!.shopping.filter((s) => s.cookId === session.id);
  rows[0].name = '2 tins chickpeas – low sodium';
  rows[0].checked = true;
  plan.weekly!.shopping = plan.weekly!.shopping.filter((s) => s.id !== rows[1].id);
  for (const quantity of [4, 6]) {
    plan = saveCooking(
      plan,
      { ...session, quantity },
      slots,
      'chickpea-curry',
      shoppingForBatch(recipe, quantity)
    );
    expect(plan.activities[0]).toMatchObject({
      title: 'Curry with naan tonight',
      notes: 'Add extra chilli'
    });
    expect(plan.weekly!.images!['personal-meal']).toBe('lemon-pasta');
    expect(plan.weekly!.shopping.find((s) => s.id === rows[0].id)).toMatchObject({
      name: '2 tins chickpeas – low sodium',
      checked: true
    });
    expect(plan.weekly!.shopping.some((s) => s.id === rows[1].id)).toBe(false);
  }
  expect(plan.weekly!.shopping.find((s) => s.id === rows[2].id)!.name).toBe('600 ml coconut milk');
});

it('optionally removes only meals linked to the removed cooking session', () => {
  const plan = createPlaygroundPlan(week);
  const session = plan.weekly!.sessions![0];
  const linked = new Set(servingSlots(plan, session.id).map((meal) => meal.id));
  expect(linked.size).toBeGreaterThan(0);
  const next = removeCooking(plan, session.id, true);
  expect(next.activities.map((meal) => meal.id)).toEqual(
    plan.activities.filter((meal) => !linked.has(meal.id)).map((meal) => meal.id)
  );
  expect(next.weekly?.sessions?.some((cook) => cook.id === session.id)).toBe(false);
  expect(next.recipes).toEqual(plan.recipes);
  expect(parseKitchenPlan(next)).toEqual(next);
});
