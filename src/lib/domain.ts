import { addMinutes, compareLocal, parseDay } from './calendar';

export type Id = string;
export type Day = string;
export type LocalTime = { day: Day; minute: number };
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
export type Warning = { code: string; entityIds: Id[]; message: string };

const validTime = (time: LocalTime): boolean => {
  try {
    parseDay(time.day);
    return Number.isSafeInteger(time.minute) && time.minute >= 0 && time.minute < 1440;
  } catch {
    return false;
  }
};
// Bound one session's work, not the number of days a user can plan ahead.
export const MAX_ACTIVITY_MINUTES = 365 * 24 * 60;
const validDuration = (minutes: number): boolean =>
  Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= MAX_ACTIVITY_MINUTES;
const validQuantity = (quantity: number): boolean => Number.isFinite(quantity) && quantity > 0;
const validRange = (range: MinuteRange): boolean =>
  Number.isSafeInteger(range.start) &&
  Number.isSafeInteger(range.end) &&
  range.start >= 0 &&
  range.end <= 1440 &&
  range.end > range.start;

export function activityEnd(activity: Activity): LocalTime {
  return addMinutes(activity.start, activity.elapsedMinutes);
}

export function batchReadyAt(plan: Plan, batch: Batch): LocalTime | undefined {
  if (batch.source.kind === 'existing') return batch.source.availableAt;
  const producerId = batch.source.activityId;
  const producer = plan.activities.find((activity) => activity.id === producerId);
  return producer ? activityEnd(producer) : undefined;
}

export function allocationAt(plan: Plan, allocation: Allocation): LocalTime | undefined {
  const activity = plan.activities.find((candidate) => candidate.id === allocation.activityId);
  return activity
    ? allocation.when === 'start'
      ? activity.start
      : activityEnd(activity)
    : undefined;
}

export function batchTotals(
  plan: Plan,
  batchId: Id
): { produced: number; assigned: number; remaining: number } {
  const produced = plan.batches.find((batch) => batch.id === batchId)?.quantity ?? 0;
  const assigned = plan.allocations.reduce(
    (sum, allocation) =>
      sum +
      (allocation.batchId === batchId && Number.isFinite(allocation.quantity)
        ? allocation.quantity
        : 0),
    0
  );
  return { produced, assigned, remaining: produced - assigned };
}

export function connectedIds(plan: Plan, activityId: Id): Set<Id> {
  const visited = new Set<Id>([activityId]);
  const edges = new Map<Id, Set<Id>>();
  const link = (a: Id, b: Id) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  };
  for (const batch of plan.batches) {
    if (batch.source.kind === 'activity') link(batch.source.activityId, batch.id);
  }
  for (const allocation of plan.allocations) link(allocation.activityId, allocation.batchId);
  const queue = [activityId];
  for (let index = 0; index < queue.length; index++) {
    for (const neighbor of edges.get(queue[index]) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

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

export function removeBatch(plan: Plan, id: Id): Plan {
  return {
    ...plan,
    batches: plan.batches.filter((batch) => batch.id !== id),
    allocations: plan.allocations.filter((allocation) => allocation.batchId !== id)
  };
}

export function validatePlan(plan: Plan): Warning[] {
  const warnings: Warning[] = [];
  const warn = (code: string, entityIds: Id[], message: string) =>
    warnings.push({ code, entityIds, message });
  const activities = new Map(plan.activities.map((activity) => [activity.id, activity]));
  const batches = new Map(plan.batches.map((batch) => [batch.id, batch]));
  const sessionEnds = new Map<Id, LocalTime>();
  for (const [day, availability] of Object.entries(plan.availability)) {
    try {
      parseDay(day);
    } catch {
      warn('INVALID_DAY', [day], `Invalid availability day ${day}.`);
    }
    for (const [category, ranges] of [
      ['cookable', availability.cookable],
      ['atHome', availability.atHome]
    ] as const) {
      for (const range of ranges)
        if (!validRange(range))
          warn('INVALID_RANGE', [day], `Invalid ${category} range on ${day}.`);
    }
  }
  for (const activity of plan.activities) {
    try {
      if (
        !validTime(activity.start) ||
        !validDuration(activity.elapsedMinutes) ||
        !validDuration(activity.handsOnMinutes)
      )
        throw new RangeError('Invalid session');
      // Check the full end before following readiness links.
      sessionEnds.set(activity.id, activityEnd(activity));
    } catch {
      warn(
        'INVALID_TIME',
        [activity.id],
        `Check the date and duration for ${activity.title}. Sessions must end within years 0-9999 and last at most ${MAX_ACTIVITY_MINUTES} minutes.`
      );
      continue;
    }
  }
  for (const batch of plan.batches) {
    if (!validQuantity(batch.quantity))
      warn('INVALID_QUANTITY', [batch.id], `Invalid quantity for ${batch.name}.`);
    if (batch.source.kind === 'activity' && !activities.has(batch.source.activityId))
      warn(
        'MISSING_ACTIVITY',
        [batch.id, batch.source.activityId],
        `${batch.name} has no producing activity.`
      );
    if (batch.source.kind === 'existing' && !validTime(batch.source.availableAt))
      warn('INVALID_TIME', [batch.id], `Invalid ready time for ${batch.name}.`);
    const totals = batchTotals(plan, batch.id);
    if (Number.isFinite(totals.remaining) && totals.remaining < -1e-9)
      warn(
        'OVER_ALLOCATED',
        [batch.id],
        `${batch.name} is over-allocated by ${-totals.remaining}.`
      );
  }
  const ingredients = new Map<Id, Set<Id>>();
  for (const allocation of plan.allocations) {
    if (!validQuantity(allocation.quantity))
      warn('INVALID_QUANTITY', [allocation.id], `Invalid allocation quantity.`);
    const batch = batches.get(allocation.batchId);
    const consumer = activities.get(allocation.activityId);
    if (!batch)
      warn(
        'MISSING_BATCH',
        [allocation.id, allocation.batchId],
        `Allocation refers to a missing batch.`
      );
    if (!consumer)
      warn(
        'MISSING_ACTIVITY',
        [allocation.id, allocation.activityId],
        `Allocation refers to a missing activity.`
      );
    if (!batch || !consumer) continue;
    const producerId = batch.source.kind === 'activity' ? batch.source.activityId : undefined;
    if (producerId === consumer.id && allocation.purpose === 'ingredient') {
      warn(
        'OWN_INGREDIENT',
        [allocation.id, batch.id, consumer.id],
        `An activity cannot use its own output as an ingredient.`
      );
    }
    if (producerId && allocation.purpose === 'ingredient' && activities.has(producerId)) {
      if (!ingredients.has(producerId)) ingredients.set(producerId, new Set());
      ingredients.get(producerId)!.add(consumer.id);
    }
    if (
      !sessionEnds.has(consumer.id) ||
      (batch.source.kind === 'existing' && !validTime(batch.source.availableAt)) ||
      (producerId && !sessionEnds.has(producerId))
    )
      continue;
    const ready =
      batch.source.kind === 'existing'
        ? batch.source.availableAt
        : sessionEnds.get(batch.source.activityId)!;
    const at = allocation.when === 'start' ? consumer.start : sessionEnds.get(consumer.id)!;
    if (compareLocal(at, ready) < 0)
      warn(
        'BEFORE_READY',
        [allocation.id, batch.id, consumer.id],
        `${batch.name} is assigned before it is ready.`
      );
  }
  const state = new Map<Id, number>();
  const stack: Id[] = [];
  const cycles = new Set<string>();
  const visit = (id: Id) => {
    state.set(id, 1);
    stack.push(id);
    for (const next of ingredients.get(id) ?? []) {
      if (state.get(next) === 1) {
        const members = stack.slice(stack.indexOf(next));
        const key = [...members].sort().join('\0');
        if (!cycles.has(key)) {
          cycles.add(key);
          warn(
            'INGREDIENT_CYCLE',
            members,
            `Ingredient dependency cycle involving ${members.join(', ')}.`
          );
        }
      } else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of ingredients.keys()) if (!state.has(id)) visit(id);
  for (let i = 0; i < plan.activities.length; i++) {
    const a = plan.activities[i];
    if (!sessionEnds.has(a.id) || a.elapsedMinutes === 0) continue;
    for (let j = i + 1; j < plan.activities.length; j++) {
      const b = plan.activities[j];
      if (!sessionEnds.has(b.id) || b.elapsedMinutes === 0) continue;
      if (
        compareLocal(a.start, sessionEnds.get(b.id)!) < 0 &&
        compareLocal(b.start, sessionEnds.get(a.id)!) < 0
      ) {
        warn('POSSIBLE_OVERLAP', [a.id, b.id], `${a.title} and ${b.title} overlap.`);
      }
    }
  }
  return warnings;
}

export function activityIssues(plan: Plan, id: Id): Warning[] {
  return validatePlan(plan).filter((warning) => warning.entityIds.includes(id));
}
