import { createKitchenPlan } from '../../tests/fixtures/legacy-plan';
import { describe, expect, it } from 'vitest';
import { mergePlans } from './plan-merge';
import { emptyKitchen } from './planner';

const initial = () => ({
  ...emptyKitchen(),
  weekly: {
    styles: {},
    shopping: [
      { id: 'tomato', name: 'Tomatoes', checked: false },
      { id: 'bread', name: 'Bread', checked: false }
    ]
  }
});
describe('independent household edits', () => {
  it('combines checking, adding and removing different shopping items', () => {
    const base = initial(),
      local = initial(),
      remote = initial();
    local.weekly.shopping[0].checked = true;
    remote.weekly.shopping = [
      remote.weekly.shopping[0],
      { id: 'milk', name: 'Milk', checked: false }
    ];
    const result = mergePlans(base, local, remote)!;
    expect(result.weekly!.shopping).toEqual([
      { id: 'tomato', name: 'Tomatoes', checked: true },
      { id: 'milk', name: 'Milk', checked: false }
    ]);
  });
  it('accepts the same checkbox change, but rejects editing an item removed elsewhere', () => {
    const base = initial(),
      local = initial(),
      remote = initial();
    local.weekly.shopping[0].checked = remote.weekly.shopping[0].checked = true;
    expect(mergePlans(base, local, remote)).toEqual(local);
    remote.weekly.shopping.shift();
    expect(mergePlans(base, local, remote)).toBeNull();
  });
  it('does not silently combine two edits to the same recipe', () => {
    const recipe = {
      id: 'soup',
      name: 'Soup',
      yieldQuantity: 4,
      durationMinutes: 20,
      ingredients: [],
      instructions: ''
    };
    const base = { ...initial(), recipes: [recipe] };
    const local = { ...base, recipes: [{ ...recipe, name: 'Tomato soup' }] };
    const remote = { ...base, recipes: [{ ...recipe, yieldQuantity: 2 }] };
    expect(mergePlans(base, local, remote)).toBeNull();
  });
  it('merges the first shopping lists created independently', () => {
    const base = emptyKitchen();
    const local = { ...base, weekly: { styles: {}, shopping: [initial().weekly.shopping[0]] } };
    const remote = { ...base, weekly: { styles: {}, shopping: [initial().weekly.shopping[1]] } };
    expect(mergePlans(base, local, remote)!.weekly!.shopping).toHaveLength(2);
  });
  it('keeps concurrent scheduling changes together instead of merging dependencies', () => {
    const base = createKitchenPlan('2026-09-21');
    const local = structuredClone(base),
      remote = structuredClone(base);
    local.activities[0].title = 'Changed locally';
    remote.activities[1].title = 'Changed remotely';
    expect(mergePlans(base, local, remote)).toBeNull();
  });
});
