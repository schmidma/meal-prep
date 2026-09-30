import { describe, expect, it } from 'vitest';
import { emptyKitchen, mealSlot, mealStyle } from './planner';
import { parseKitchenPlan } from './plan-document';
import { deleteActivity } from './kitchen';
import type { Activity } from './domain';

const meal: Activity = {
  id: 'meal',
  title: 'Pasta',
  kind: 'meal',
  start: { day: '2026-09-28', minute: 750 },
  elapsedMinutes: 30,
  handsOnMinutes: 0,
  requiresHome: false,
  notes: ''
};
describe('weekly planner compatibility', () => {
  it('accepts legacy documents without weekly extras and persists new extras', () => {
    const legacy = emptyKitchen();
    expect(parseKitchenPlan(legacy)).toEqual(legacy);
    const plan = {
      ...legacy,
      activities: [meal],
      weekly: {
        shopping: [{ id: 'shop', name: 'Bread', checked: true }],
        styles: { meal: 'easy' as const }
      }
    };
    expect(parseKitchenPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(deleteActivity(plan, meal.id).weekly).toEqual(plan.weekly);
  });
  it('rejects malformed shared shopping and meal styles', () => {
    const plan = {
      ...emptyKitchen(),
      weekly: { shopping: [{ id: 'shop', name: 'Bread', checked: 'yes' }], styles: {} }
    };
    expect(() => parseKitchenPlan(plan)).toThrow();
    expect(() =>
      parseKitchenPlan({ ...emptyKitchen(), weekly: { shopping: [], styles: { meal: 'unknown' } } })
    ).toThrow();
  });
  it('groups existing times and honours explicit style over historical allocations', () => {
    expect(mealSlot(meal)).toBe('Lunch');
    expect(mealSlot({ ...meal, start: { ...meal.start, minute: 480 } })).toBe('Breakfast');
    expect(mealSlot({ ...meal, start: { ...meal.start, minute: 1200 } })).toBe('Dinner');
    const plan = {
      ...emptyKitchen(),
      activities: [meal],
      allocations: [
        {
          id: 'allocation',
          activityId: 'meal',
          batchId: 'batch',
          quantity: 1,
          purpose: 'eat' as const,
          when: 'start' as const
        }
      ]
    };
    expect(mealStyle(plan, meal)).toBe('leftovers');
    expect(mealStyle({ ...plan, weekly: { shopping: [], styles: { meal: 'easy' } } }, meal)).toBe(
      'easy'
    );
  });
});
