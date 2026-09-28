import { addDays, formatTime, parseDay } from './calendar';
import {
  allocationAt,
  batchReadyAt,
  type Allocation,
  type LocalTime,
  type Warning
} from './domain';
import type { KitchenPlan } from './kitchen';

export type EntityRef = { kind: 'activity' | 'batch' | 'ingredient' | 'block'; id: string };
export type RelationSelection = { allocationIds: string[]; ingredientUseIds: string[] };
export type KitchenFocus = {
  entityIds: Set<string>;
  allocationIds: Set<string>;
  ingredientUseIds: Set<string>;
};

export function entityRef(plan: KitchenPlan, id: string | null): EntityRef | undefined {
  if (!id) return;
  if (plan.activities.some((item) => item.id === id)) return { kind: 'activity', id };
  if (plan.batches.some((item) => item.id === id)) return { kind: 'batch', id };
  if (plan.ingredients.some((item) => item.id === id)) return { kind: 'ingredient', id };
  if (plan.blockers.some((item) => item.id === id)) return { kind: 'block', id };
}

/** Direct relationships only. Included neighbors are never expanded recursively. */
export function kitchenFocus(
  plan: KitchenPlan,
  root?: EntityRef,
  selection?: RelationSelection
): KitchenFocus {
  const focus: KitchenFocus = {
    entityIds: new Set(),
    allocationIds: new Set(),
    ingredientUseIds: new Set()
  };
  const includeBatch = (id: string) => {
    const batch = plan.batches.find((item) => item.id === id);
    if (!batch) return;
    focus.entityIds.add(id);
    if (batch.source.kind === 'activity') focus.entityIds.add(batch.source.activityId);
  };
  const outputs = new Set(
    root?.kind === 'activity'
      ? plan.batches
          .filter(
            (batch) => batch.source.kind === 'activity' && batch.source.activityId === root.id
          )
          .map((batch) => batch.id)
      : []
  );
  if (!selection && root) {
    focus.entityIds.add(root.id);
    if (root.kind === 'batch') includeBatch(root.id);
    for (const id of outputs) includeBatch(id);
  }
  for (const allocation of plan.allocations) {
    const include = selection
      ? selection.allocationIds.includes(allocation.id)
      : root?.kind === 'activity'
        ? allocation.activityId === root.id || outputs.has(allocation.batchId)
        : root?.kind === 'batch' && allocation.batchId === root.id;
    if (!include) continue;
    focus.allocationIds.add(allocation.id);
    focus.entityIds.add(allocation.activityId);
    includeBatch(allocation.batchId);
  }
  for (const use of plan.ingredientUses) {
    const include = selection
      ? selection.ingredientUseIds.includes(use.id)
      : root?.kind === 'activity'
        ? use.activityId === root.id
        : root?.kind === 'ingredient' && use.ingredientId === root.id;
    if (!include) continue;
    focus.ingredientUseIds.add(use.id);
    focus.entityIds.add(use.ingredientId);
    focus.entityIds.add(use.activityId);
  }
  return focus;
}

export function patchAllocationAmount(plan: KitchenPlan, id: string, amount: number): KitchenPlan {
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error('Enter a valid nonnegative quantity.');
  return {
    ...plan,
    allocations:
      amount === 0
        ? plan.allocations.filter((item) => item.id !== id)
        : plan.allocations.map((item) => (item.id === id ? { ...item, quantity: amount } : item))
  };
}

export function patchIngredientUseAmount(
  plan: KitchenPlan,
  id: string,
  amount: number
): KitchenPlan {
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error('Enter a valid nonnegative quantity.');
  return {
    ...plan,
    ingredientUses:
      amount === 0
        ? plan.ingredientUses.filter((item) => item.id !== id)
        : plan.ingredientUses.map((item) => (item.id === id ? { ...item, quantity: amount } : item))
  };
}

/** Increment one identified record without replacing parallel uses of the same stock. */
export function addIngredientAssignment(
  plan: KitchenPlan,
  ingredientId: string,
  activityId: string,
  amount: number,
  newId: () => string
): KitchenPlan {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error('Enter a positive, finite quantity.');
  if (
    !plan.ingredients.some((item) => item.id === ingredientId) ||
    !plan.activities.some((item) => item.id === activityId)
  )
    throw new Error('Food or activity not found.');
  const existing = plan.ingredientUses.find(
    (item) => item.ingredientId === ingredientId && item.activityId === activityId
  );
  if (existing) return patchIngredientUseAmount(plan, existing.id, existing.quantity + amount);
  return {
    ...plan,
    ingredientUses: [
      ...plan.ingredientUses,
      { id: newId(), ingredientId, activityId, quantity: amount }
    ]
  };
}

/** Increment one default-purpose/time record, preserving all parallel records and their order. */
export function addBatchAssignment(
  plan: KitchenPlan,
  batchId: string,
  activityId: string,
  amount: number,
  newId: () => string
): KitchenPlan {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error('Enter a positive, finite quantity.');
  const batch = plan.batches.find((item) => item.id === batchId);
  const activity = plan.activities.find((item) => item.id === activityId);
  if (!batch || !activity) throw new Error('Food or activity not found.');
  const own = batch.source.kind === 'activity' && batch.source.activityId === activityId;
  const purpose = own || activity.kind !== 'cook' ? 'eat' : 'ingredient';
  const when = own ? 'end' : 'start';
  const existing = plan.allocations.find(
    (item) =>
      item.batchId === batchId &&
      item.activityId === activityId &&
      item.purpose === purpose &&
      item.when === when
  );
  if (existing) return patchAllocationAmount(plan, existing.id, existing.quantity + amount);
  return {
    ...plan,
    allocations: [
      ...plan.allocations,
      {
        id: newId(),
        batchId,
        activityId,
        quantity: amount,
        purpose,
        when
      }
    ]
  };
}

export const fullTime = (at: LocalTime): string =>
  `${parseDay(at.day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${formatTime(at.minute)}`;
export function allocationDescription(plan: KitchenPlan, allocation: Allocation): string {
  const at = allocationAt(plan, allocation);
  return `${allocation.purpose === 'ingredient' ? 'Ingredient' : 'Eat'} at ${allocation.when}${at ? ` / ${fullTime(at)}` : ''}`;
}

export type WarningTarget = { entity: EntityRef; label: string; at?: LocalTime };
export function warningTargets(plan: KitchenPlan, warning: Warning): WarningTarget[] {
  const targets = new Map<string, WarningTarget>();
  const add = (entity: EntityRef, at?: LocalTime) => {
    const ref = entityRef(plan, entity.id);
    if (!ref || ref.kind !== entity.kind) return;
    const item =
      entity.kind === 'activity'
        ? plan.activities.find((item) => item.id === entity.id)
        : entity.kind === 'block'
          ? plan.blockers.find((item) => item.id === entity.id)
          : entity.kind === 'batch'
            ? plan.batches.find((item) => item.id === entity.id)
            : plan.ingredients.find((item) => item.id === entity.id);
    const key = `${entity.kind}:${entity.id}`;
    if (!targets.has(key) || at)
      targets.set(key, {
        entity,
        label: (item && ('title' in item ? item.title : item.name)) || entity.id,
        at
      });
  };
  const safeTime = (get: () => LocalTime | undefined) => {
    try {
      return get();
    } catch {
      return undefined;
    }
  };
  for (const id of warning.entityIds) {
    const ref = entityRef(plan, id);
    if (ref) add(ref);
    const allocation = plan.allocations.find((item) => item.id === id);
    if (allocation) {
      add(
        { kind: 'activity', id: allocation.activityId },
        safeTime(() => allocationAt(plan, allocation))
      );
      add({ kind: 'batch', id: allocation.batchId });
    }
    const use = plan.ingredientUses.find((item) => item.id === id);
    if (use) {
      add({ kind: 'activity', id: use.activityId });
      add({ kind: 'ingredient', id: use.ingredientId });
    }
    const batch = plan.batches.find((item) => item.id === (allocation?.batchId ?? id));
    if (batch && warning.code === 'BEFORE_READY') {
      const at = safeTime(() => batchReadyAt(plan, batch));
      add({ kind: 'batch', id: batch.id }, at);
      if (batch.source.kind === 'activity')
        add({ kind: 'activity', id: batch.source.activityId }, at);
    }
  }
  return [...targets.values()];
}

/** Keep the target visible even when a full range would extend beyond year 9999. */
export function rangeForTarget(start: string, count: number, target: string): string {
  if (target >= start && target <= addDays(start, count - 1)) return start;
  const latest = addDays('9999-12-31', -(count - 1));
  return target < '0001-01-01' ? '0001-01-01' : target > latest ? latest : target;
}
