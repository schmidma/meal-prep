import { describe, expect, it } from 'vitest';
import { createKitchenPlan } from './kitchen';
import { allocatedHere, foodChoices, suggestedAmount } from './food-choices';

describe('explicit activity food choices', () => {
  it('includes planned and existing food, excludes own outputs, and does not mutate notes or stock', () => {
    const plan = createKitchenPlan('2026-07-20');
    const before = structuredClone(plan);
    const choices = foodChoices(plan, 'cook-curry');
    expect(choices.some((item) => item.id === 'curry')).toBe(false);
    expect(choices.find((item) => item.id === 'grains')?.source).toContain('Planned / from');
    expect(choices.find((item) => item.id === 'stock-veg')?.source).toContain('Prepared / at home');
    expect(choices.find((item) => item.id === 'ing-paprika')?.remaining).toBe(2);
    expect(plan).toEqual(before);
  });
  it('matches trimmed case-folded names and sums separate raw and prepared allocations, not requirements', () => {
    const plan = createKitchenPlan('2026-07-20');
    plan.batches.find((item) => item.id === 'stock-veg')!.name = ' PAPRIKA ';
    plan.ingredientUses.push({
      id: 'raw',
      ingredientId: 'ing-paprika',
      activityId: 'cook-curry',
      quantity: 0.5
    });
    plan.allocations.push(
      {
        id: 'one',
        batchId: 'stock-veg',
        activityId: 'cook-curry',
        quantity: 1,
        purpose: 'eat',
        when: 'end'
      },
      {
        id: 'two',
        batchId: 'stock-veg',
        activityId: 'cook-curry',
        quantity: 2,
        purpose: 'ingredient',
        when: 'start'
      }
    );
    expect(allocatedHere(plan, 'cook-curry', ' paprika')).toBe(3.5);
    expect(allocatedHere(plan, 'cook-curry', 'pepper')).toBe(0);
    expect(allocatedHere(plan, 'cook-curry', 'Coconut curry')).toBe(0);
  });
  it('suggests only positive availability up to the outstanding need', () => {
    expect(suggestedAmount(3, 2)).toBe(2);
    expect(suggestedAmount(0.5, 2)).toBe(0.5);
    expect(suggestedAmount(-1, 2)).toBe(0);
    expect(suggestedAmount(3, 0)).toBe(0);
    expect(suggestedAmount(3)).toBe(3);
  });
});
