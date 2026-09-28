import { formatTime, parseDay } from './calendar';
import {
  batchReadyAt,
  type Activity,
  type Allocation,
  type Batch,
  type Plan,
  type Warning
} from './domain';

export function newId(prefix: string): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}
/** Display only: clean subtraction noise, then mark rounding beyond six significant digits. */
export function quantity(value: number, reference = value): string {
  if (!Number.isFinite(value)) return '?';
  const lostDigits =
    value && Number.isFinite(reference)
      ? Math.max(0, Math.ceil(Math.log10(Math.abs(reference / value))))
      : 0;
  const normalized = Number(value.toPrecision(Math.max(1, 15 - lostDigits)));
  const clean = Number.isFinite(normalized) ? normalized : value;
  const rounded = Number(clean.toPrecision(6));
  const decimal = new Intl.NumberFormat('en', { maximumSignificantDigits: 6 }).format(clean);
  const [mantissa, exponent] = clean.toExponential(5).split('e');
  const compact = decimal.length > 12 ? `${Number(mantissa)}e${exponent}` : decimal;
  return `${rounded === clean ? '' : '≈'}${compact}`;
}
/** Normalize subtraction residue only for displayed balances, never stock or input values. */
export function displayBalance(available: number, assigned: number): number {
  const remaining = available - assigned;
  const noise = Math.min(
    1e-9,
    Number.EPSILON * Math.max(Math.abs(available), Math.abs(assigned)) * 4
  );
  return Math.abs(remaining) <= noise ? 0 : remaining;
}
export const dateLabel = (
  day: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }
): string => parseDay(day).toLocaleDateString('en-GB', options);
export const activityLabel = (activity: Activity): string =>
  `${dateLabel(activity.start.day, { weekday: 'short', day: 'numeric' })}, ${formatTime(activity.start.minute)} - ${activity.title}`;
export function readyLabel(plan: Plan, batch: Batch): string {
  try {
    const ready = batchReadyAt(plan, batch);
    return ready ? `${dateLabel(ready.day)}, ${formatTime(ready.minute)}` : 'No source activity';
  } catch {
    return 'Set a valid date and duration';
  }
}
export type FoodConnectionGroup = {
  key: string;
  sourceId: string;
  targetId: string;
  parts: (Allocation & { batchName: string })[];
};

/** Route each allocation independently: food, timing and partial focus never get merged. */
export function groupFoodConnections(
  plan: Plan,
  allocationIds?: Set<string>
): FoodConnectionGroup[] {
  const batches = new Map(plan.batches.map((batch) => [batch.id, batch]));
  const groups = new Map<string, FoodConnectionGroup>();
  for (const allocation of plan.allocations) {
    if (allocationIds && !allocationIds.has(allocation.id)) continue;
    const batch = batches.get(allocation.batchId);
    const source = batch?.source;
    if (!source || source.kind !== 'activity' || source.activityId === allocation.activityId)
      continue;
    const sourceId = source.activityId;
    const targetId = allocation.activityId;
    const key = allocation.id;
    let group = groups.get(key);
    if (!group) {
      group = { key, sourceId, targetId, parts: [] };
      groups.set(key, group);
    }
    group.parts.push({ ...allocation, batchName: batch!.name });
  }
  return [...groups.values()];
}

export function warningsFor(plan: Plan, warnings: Warning[], activityId: string): Warning[] {
  const ids = new Set([activityId]);
  for (const batch of plan.batches)
    if (batch.source.kind === 'activity' && batch.source.activityId === activityId)
      ids.add(batch.id);
  for (const allocation of plan.allocations)
    if (allocation.activityId === activityId) ids.add(allocation.id);
  return warnings.filter((warning) => warning.entityIds.some((id) => ids.has(id)));
}
export function shortWarning(code: string): string {
  return (
    (
      {
        BEFORE_READY: 'Food not ready in time',
        OVER_ALLOCATED: 'Too much assigned',
        BLOCKED_TIME: 'Overlaps blocked time',
        POSSIBLE_OVERLAP: 'Overlapping activities',
        INGREDIENT_CYCLE: 'Circular dependency',
        OWN_INGREDIENT: 'Needs its own output'
      } as Record<string, string>
    )[code] ?? 'Check this activity'
  );
}
