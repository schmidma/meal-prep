import type { KitchenPlan } from './kitchen';
import { parseKitchenPlan } from './plan-document';

const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    return (
      Object.keys(left).length === Object.keys(right).length &&
      Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
    );
  }
  return false;
};
const conflict = () => {
  throw new Error('Overlapping edits');
};
const choose = (base: unknown, local: unknown, remote: unknown): unknown => {
  if (equal(local, remote) || equal(base, remote)) return local;
  if (equal(base, local)) return remote;
  return conflict();
};
function merge(base: unknown, local: unknown, remote: unknown): unknown {
  if (equal(local, remote) || equal(base, remote)) return local;
  if (equal(base, local)) return remote;
  if (
    Array.isArray(local) &&
    Array.isArray(remote) &&
    (base === undefined || Array.isArray(base))
  ) {
    const original = (base ?? []) as unknown[];
    const identified = (items: unknown[]) =>
      items.every(
        (item) =>
          item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
      );
    if (![original, local, remote].every(identified)) return conflict();
    const index = (items: unknown[]) =>
      new Map(items.map((item) => [(item as { id: string }).id, item]));
    const b = index(original),
      l = index(local),
      r = index(remote);
    // Keep the server's order, appending new local items. Each entity is atomic:
    // renaming a recipe while another person edits its ingredients needs a decision.
    return [...new Set([...r.keys(), ...l.keys()])].flatMap((id) => {
      const value = choose(b.get(id), l.get(id), r.get(id));
      return value === undefined ? [] : [value];
    });
  }
  if (
    local &&
    remote &&
    typeof local === 'object' &&
    typeof remote === 'object' &&
    !Array.isArray(local) &&
    !Array.isArray(remote) &&
    (base === undefined || (base && typeof base === 'object' && !Array.isArray(base)))
  ) {
    const b = (base ?? {}) as Record<string, unknown>,
      l = local as Record<string, unknown>,
      r = remote as Record<string, unknown>;
    return Object.fromEntries(
      [...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])]
        .map((key) => [key, merge(b[key], l[key], r[key])])
        .filter(([, value]) => value !== undefined)
    );
  }
  return conflict();
}
// Scheduling quantities and relationships span multiple records. Treat the
// scheduling graph as one change to avoid combining individually valid moves
// into an overallocated batch or a meal before its cooking session.
function schedule(plan: KitchenPlan) {
  return {
    activities: plan.activities,
    batches: plan.batches,
    allocations: plan.allocations,
    ingredientUses: plan.ingredientUses,
    activityRequirements: plan.activityRequirements,
    availability: plan.availability,
    blockers: plan.blockers,
    sessions: plan.weekly?.sessions ?? [],
    mealSources: plan.weekly?.mealSources ?? {},
    leftoverSources: plan.weekly?.leftoverSources ?? {},
    mealSections: plan.weekly?.mealSections ?? {},
    settings: plan.weekly?.settings
  };
}
export function mergePlans(
  base: KitchenPlan,
  local: KitchenPlan,
  remote: KitchenPlan
): KitchenPlan | null {
  try {
    choose(schedule(base), schedule(local), schedule(remote));
    return parseKitchenPlan(merge(base, local, remote));
  } catch {
    return null;
  }
}
