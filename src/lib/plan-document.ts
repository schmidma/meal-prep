import { addMinutes, parseDay } from './calendar';
import { MAX_ACTIVITY_MINUTES } from './domain';
import type { KitchenPlan } from './kitchen';

export const PLAN_SCHEMA_VERSION = 2 as const;
export const LEGACY_MAX_PLAN_BYTES = 500_000;
// Adding the two empty arrays grows every JSON v1 plan by exactly 39 UTF-8 bytes.
export const MAX_PLAN_BYTES = LEGACY_MAX_PLAN_BYTES + 39;
export type PlanDocument = {
  schemaVersion: 2;
  revision: number;
  updatedAt: string;
  plan: KitchenPlan;
};
export type SaveRequest = Pick<PlanDocument, 'schemaVersion' | 'revision' | 'plan'>;

function invalid(): never {
  throw new Error('Invalid plan document');
}

function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalid();
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    return invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  return value;
}

function list(input: unknown): unknown[] {
  if (!Array.isArray(input)) return invalid();
  return input;
}

function text(input: unknown, nonblank = false): string {
  if (typeof input !== 'string' || input.length > 10_000 || (nonblank && !input.trim()))
    return invalid();
  return input;
}

function id(input: unknown): string {
  const value = text(input, true);
  if (value.length > 256) return invalid();
  return value;
}

function integer(input: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum || (input as number) > maximum)
    return invalid();
  return input as number;
}

function quantity(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return invalid();
  return input;
}

function choice<T extends string>(input: unknown, choices: readonly T[]): T {
  if (typeof input !== 'string' || !choices.includes(input as T)) return invalid();
  return input as T;
}

function day(input: unknown): string {
  if (typeof input !== 'string' || input.length !== 10) return invalid();
  try {
    parseDay(input);
  } catch {
    return invalid();
  }
  return input;
}

function time(input: unknown): { day: string; minute: number } {
  const value = object(input, ['day', 'minute']);
  return { day: day(value.day), minute: integer(value.minute, 0, 1439) };
}

function session(start: { day: string; minute: number }, duration: number): void {
  try {
    addMinutes(start, duration);
  } catch {
    invalid();
  }
}

function checkSize(input: unknown, maximum = MAX_PLAN_BYTES): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    invalid();
  }
  if (serialized === undefined) invalid();
  if (new TextEncoder().encode(serialized).length > maximum)
    throw new Error('This plan exceeds the current 500 kB size limit. No changes were applied.');
}

const legacyPlanKeys = [
  'activities',
  'batches',
  'allocations',
  'availability',
  'ingredients',
  'ingredientUses',
  'blockers'
];

export function migrateV1KitchenPlan(input: unknown): KitchenPlan {
  checkSize(input, LEGACY_MAX_PLAN_BYTES);
  const legacy = object(input, legacyPlanKeys);
  return parseKitchenPlan({ ...legacy, recipes: [], activityRequirements: [] });
}

export function parseKitchenPlan(input: unknown): KitchenPlan {
  checkSize(input);
  const plan = object(input, [...legacyPlanKeys, 'recipes', 'activityRequirements']);
  const ids = new Set<string>();
  const activityIds = new Set<string>();
  const batchIds = new Set<string>();
  const ingredientIds = new Set<string>();
  const register = (inputId: unknown, group: Set<string>): string => {
    const value = id(inputId);
    if (ids.has(value)) invalid();
    ids.add(value);
    group.add(value);
    return value;
  };
  for (const item of list(plan.activities)) {
    const activity = object(item, [
      'id',
      'title',
      'kind',
      'start',
      'elapsedMinutes',
      'handsOnMinutes',
      'requiresHome',
      'notes'
    ]);
    register(activity.id, activityIds);
    text(activity.title, true);
    choice(activity.kind, ['cook', 'meal', 'other']);
    const start = time(activity.start);
    session(start, integer(activity.elapsedMinutes, 0, MAX_ACTIVITY_MINUTES));
    integer(activity.handsOnMinutes, 0, MAX_ACTIVITY_MINUTES);
    if (typeof activity.requiresHome !== 'boolean') invalid();
    text(activity.notes);
  }
  for (const item of list(plan.batches)) {
    const batch = object(item, ['id', 'name', 'quantity', 'unit', 'source']);
    register(batch.id, batchIds);
    text(batch.name, true);
    quantity(batch.quantity);
    text(batch.unit);
    const source = batch.source;
    if (source === null || typeof source !== 'object' || Array.isArray(source)) invalid();
    if ((source as { kind?: unknown }).kind === 'activity') {
      const producer = object(source, ['kind', 'activityId']);
      if (!activityIds.has(id(producer.activityId))) invalid();
    } else {
      const existing = object(source, ['kind', 'availableAt']);
      choice(existing.kind, ['existing']);
      time(existing.availableAt);
    }
  }
  for (const item of list(plan.allocations)) {
    const allocation = object(item, ['id', 'batchId', 'activityId', 'quantity', 'purpose', 'when']);
    register(allocation.id, new Set());
    if (!batchIds.has(id(allocation.batchId)) || !activityIds.has(id(allocation.activityId)))
      invalid();
    quantity(allocation.quantity);
    choice(allocation.purpose, ['eat', 'ingredient']);
    choice(allocation.when, ['start', 'end']);
  }
  for (const item of list(plan.ingredients)) {
    const ingredient = object(item, ['id', 'name', 'quantity', 'unit']);
    register(ingredient.id, ingredientIds);
    text(ingredient.name, true);
    quantity(ingredient.quantity);
    text(ingredient.unit);
  }
  for (const item of list(plan.ingredientUses)) {
    const use = object(item, ['id', 'ingredientId', 'activityId', 'quantity']);
    register(use.id, new Set());
    if (!ingredientIds.has(id(use.ingredientId)) || !activityIds.has(id(use.activityId))) invalid();
    quantity(use.quantity);
  }
  for (const item of list(plan.blockers)) {
    const blocker = object(item, ['id', 'title', 'start', 'durationMinutes', 'away']);
    register(blocker.id, new Set());
    text(blocker.title, true);
    const start = time(blocker.start);
    session(start, integer(blocker.durationMinutes, 1, MAX_ACTIVITY_MINUTES));
    if (typeof blocker.away !== 'boolean') invalid();
  }
  for (const item of list(plan.recipes)) {
    const recipe = object(item, [
      'id',
      'name',
      'yieldQuantity',
      'durationMinutes',
      'ingredients',
      'instructions'
    ]);
    register(recipe.id, new Set());
    text(recipe.name, true);
    quantity(recipe.yieldQuantity);
    integer(recipe.durationMinutes, 0, MAX_ACTIVITY_MINUTES);
    text(recipe.instructions);
    for (const entry of list(recipe.ingredients)) {
      const ingredient = object(entry, ['id', 'name', 'quantity']);
      register(ingredient.id, new Set());
      text(ingredient.name, true);
      quantity(ingredient.quantity);
    }
  }
  for (const item of list(plan.activityRequirements)) {
    const requirement = object(item, ['id', 'activityId', 'name', 'quantity']);
    register(requirement.id, new Set());
    if (!activityIds.has(id(requirement.activityId))) invalid();
    text(requirement.name, true);
    quantity(requirement.quantity);
  }
  if (
    plan.availability === null ||
    typeof plan.availability !== 'object' ||
    Array.isArray(plan.availability)
  )
    invalid();
  if (
    Object.getPrototypeOf(plan.availability) !== Object.prototype &&
    Object.getPrototypeOf(plan.availability) !== null
  )
    invalid();
  for (const [date, entry] of Object.entries(plan.availability)) {
    day(date);
    const availability = object(entry, ['label', 'cookable', 'atHome']);
    text(availability.label);
    for (const group of [availability.cookable, availability.atHome]) {
      for (const item of list(group)) {
        const range = object(item, ['start', 'end']);
        const start = integer(range.start, 0, 1439);
        if (integer(range.end, 1, 1440) <= start) invalid();
      }
    }
  }
  return input as KitchenPlan;
}

function version(input: unknown): 2 {
  if (input !== PLAN_SCHEMA_VERSION) invalid();
  return PLAN_SCHEMA_VERSION;
}

export function parseSaveRequest(input: unknown): SaveRequest {
  const request = object(input, ['schemaVersion', 'revision', 'plan']);
  const schemaVersion = version(request.schemaVersion);
  const revision = integer(request.revision, 0, Number.MAX_SAFE_INTEGER - 1);
  const plan = parseKitchenPlan(request.plan);
  return { schemaVersion, revision, plan };
}

// Only recovery drafts may contain old attempted writes. The HTTP API uses parseSaveRequest.
export function parseV1RecoverySaveRequest(input: unknown): SaveRequest {
  const request = object(input, ['schemaVersion', 'revision', 'plan']);
  if (request.schemaVersion !== 1) invalid();
  const revision = integer(request.revision, 0, Number.MAX_SAFE_INTEGER - 1);
  return { schemaVersion: PLAN_SCHEMA_VERSION, revision, plan: migrateV1KitchenPlan(request.plan) };
}

export function parsePlanDocument(input: unknown): PlanDocument {
  const document = object(input, ['schemaVersion', 'revision', 'updatedAt', 'plan']);
  if (document.schemaVersion !== 1 && document.schemaVersion !== PLAN_SCHEMA_VERSION) invalid();
  const revision = integer(document.revision, 0);
  const updatedAt = text(document.updatedAt, true);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(updatedAt) ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    new Date(updatedAt).toISOString() !== updatedAt
  )
    invalid();
  const plan =
    document.schemaVersion === 1
      ? migrateV1KitchenPlan(document.plan)
      : parseKitchenPlan(document.plan);
  return { schemaVersion: PLAN_SCHEMA_VERSION, revision, updatedAt, plan };
}

// Canonical object ordering, preserving array order and all supplied fields.
export function planKey(plan: KitchenPlan): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, stable((value as Record<string, unknown>)[key])])
      );
    return value;
  };
  return JSON.stringify(stable(plan));
}
