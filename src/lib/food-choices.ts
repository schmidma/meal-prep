import { batchReadyAt, batchTotals } from './domain';
import { ingredientTotals, type KitchenPlan } from './kitchen';
import { fullTime } from './relationships';

export const foodNameKey = (name: string) => name.trim().toLocaleLowerCase();

/** Requirements are notes. Matching only summarizes actual, separately saved allocations. */
export function allocatedHere(plan: KitchenPlan, activityId: string, name: string): number {
  const key = foodNameKey(name);
  const raw = plan.ingredientUses.filter(
    (use) =>
      use.activityId === activityId &&
      plan.ingredients.some(
        (item) => item.id === use.ingredientId && foodNameKey(item.name) === key
      )
  );
  const prepared = plan.allocations.filter(
    (use) =>
      use.activityId === activityId &&
      plan.batches.some(
        (item) =>
          item.id === use.batchId &&
          foodNameKey(item.name) === key &&
          !(item.source.kind === 'activity' && item.source.activityId === activityId)
      )
  );
  return [...raw, ...prepared].reduce((sum, use) => sum + use.quantity, 0);
}

export function foodChoices(plan: KitchenPlan, activityId: string) {
  return [
    ...plan.ingredients.map((item) => ({
      kind: 'ingredient' as const,
      id: item.id,
      name: item.name,
      remaining: ingredientTotals(plan, item.id).remaining,
      source: 'Raw ingredient / at home'
    })),
    ...plan.batches
      .filter((item) => !(item.source.kind === 'activity' && item.source.activityId === activityId))
      .map((item) => {
        const producer =
          item.source.kind === 'activity'
            ? plan.activities.find(
                (activity) =>
                  item.source.kind === 'activity' && activity.id === item.source.activityId
              )
            : undefined;
        const ready = batchReadyAt(plan, item);
        return {
          kind: 'batch' as const,
          id: item.id,
          name: item.name,
          remaining: batchTotals(plan, item.id).remaining,
          source: `${producer ? `Planned / from ${producer.title}` : 'Prepared / at home'}${ready ? ` / ready ${fullTime(ready)}` : ''}`
        };
      })
  ];
}

export function suggestedAmount(remaining: number, need?: number) {
  return Math.max(0, Math.min(remaining, need === undefined ? remaining : need));
}
