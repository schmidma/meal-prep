import { describe, it, expect } from 'vitest';
import { createStarterPlan } from '../../tests/fixtures/plans';
import { recipeMatches } from './use-soon';
import { parseKitchenPlan } from './plan-document';
describe('use-soon recipe matches', () => {
  const plan = createStarterPlan();
  it('finds bell peppers from capsicum and ranks actual ingredient matches', () => {
    const items = [
      { id: 'pepper', name: 'Capsicum' },
      { id: 'spinach', name: 'Spinach' }
    ];
    expect(
      recipeMatches(
        plan.recipes.find((r) => r.id === 'recipe-bowls')!,
        items
      )
    ).toEqual([items[0]]);
    expect(
      recipeMatches(
        plan.recipes.find((r) => r.id === 'recipe-curry')!,
        items
      )
    ).toEqual([items[1]]);
  });
  it('does not match word fragments or just oil when olive oil is requested', () => {
    const recipe = {
      ...plan.recipes[0],
      ingredients: [{ id: 'x', quantity: 1, name: 'licorice and sunflower oil' }]
    };
    expect(
      recipeMatches(recipe, [
        { id: 'rice', name: 'rice' },
        { id: 'oil', name: 'olive oil' }
      ])
    ).toEqual([]);
  });
  it('persists reminders and rejects duplicate identities', () => {
    const next = {
      ...plan,
      weekly: { ...plan.weekly!, useSoon: [{ id: 'soon', name: 'Paprika' }] }
    };
    expect(parseKitchenPlan(next)).toEqual(next);
    expect(() =>
      parseKitchenPlan({
        ...next,
        weekly: { ...next.weekly, useSoon: [...next.weekly.useSoon, ...next.weekly.useSoon] }
      })
    ).toThrow();
  });
});
