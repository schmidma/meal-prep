import { expect, it } from 'vitest';
import { createKitchenPlan } from '../../tests/fixtures/legacy-plan';
import { deleteActivity } from './kitchen';

it('removes an activity and its legacy references without changing unrelated plan content', () => {
  const plan = createKitchenPlan('2026-06-01');
  const id = plan.activities[0].id;
  plan.ingredientUses.push({
    id: 'use',
    activityId: id,
    ingredientId: plan.ingredients[0].id,
    quantity: 1
  });
  plan.activityRequirements.push({ id: 'need', activityId: id, name: 'Carrots', quantity: 1 });
  const produced = new Set(
    plan.batches
      .filter((b) => b.source.kind === 'activity' && b.source.activityId === id)
      .map((b) => b.id)
  );
  const next = deleteActivity(plan, id);
  expect(next.activities.some((a) => a.id === id)).toBe(false);
  expect(next.batches.some((b) => produced.has(b.id))).toBe(false);
  expect(next.allocations.some((a) => a.activityId === id || produced.has(a.batchId))).toBe(false);
  expect(next.ingredientUses).toEqual([]);
  expect(next.activityRequirements).toEqual([]);
  expect(next.recipes).toEqual(plan.recipes);
  expect(next.ingredients).toEqual(plan.ingredients);
  expect(plan.activities.some((a) => a.id === id)).toBe(true);
});
