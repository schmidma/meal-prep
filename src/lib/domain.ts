export type Id = string;
import type { Day, LocalTime } from './calendar';
export type { Day, LocalTime } from './calendar';
export type Activity = {
  id: Id;
  title: string;
  kind: 'cook' | 'meal' | 'other';
  start: LocalTime;
  elapsedMinutes: number;
  handsOnMinutes: number;
  requiresHome: boolean;
  notes: string;
};
export type Batch = {
  recipeId?: string;
  id: Id;
  name: string;
  quantity: number;
  unit: string;
  source: { kind: 'activity'; activityId: Id } | { kind: 'existing'; availableAt: LocalTime };
};
export type Allocation = {
  id: Id;
  batchId: Id;
  activityId: Id;
  quantity: number;
  purpose: 'eat' | 'ingredient';
  when: 'start' | 'end';
};
export type MinuteRange = { start: number; end: number };
export type DayAvailability = { label: string; cookable: MinuteRange[]; atHome: MinuteRange[] };
export type Plan = {
  activities: Activity[];
  batches: Batch[];
  allocations: Allocation[];
  availability: Record<Day, DayAvailability>;
};

// Bounds a single stored activity; the planning horizon remains unrestricted.
export const MAX_ACTIVITY_MINUTES = 365 * 24 * 60;

export function removeActivity(plan: Plan, id: Id): Plan {
  const removedBatches = new Set(
    plan.batches
      .filter((batch) => batch.source.kind === 'activity' && batch.source.activityId === id)
      .map((batch) => batch.id)
  );
  return {
    ...plan,
    activities: plan.activities.filter((activity) => activity.id !== id),
    batches: plan.batches.filter((batch) => !removedBatches.has(batch.id)),
    allocations: plan.allocations.filter(
      (allocation) => allocation.activityId !== id && !removedBatches.has(allocation.batchId)
    )
  };
}
