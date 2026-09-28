import { addDays, addMinutes, compareLocal, parseDay } from './calendar';
import {
  MAX_ACTIVITY_MINUTES,
  removeActivity,
  validatePlan,
  type Day,
  type LocalTime,
  type Plan,
  type Warning
} from './domain';
import { createExamplePlan } from './example-plan';

export type { Day, LocalTime, Plan, Warning } from './domain';
export type RecipeIngredient = { id: string; name: string; quantity: number };
export type Recipe = {
  id: string;
  name: string;
  yieldQuantity: number;
  durationMinutes: number;
  ingredients: RecipeIngredient[];
  instructions: string;
};
export type ActivityRequirement = {
  id: string;
  activityId: string;
  name: string;
  quantity: number;
};
export type Ingredient = { id: string; name: string; quantity: number; unit: string };
export type IngredientUse = {
  id: string;
  ingredientId: string;
  activityId: string;
  quantity: number;
};
export type Blocker = {
  id: string;
  title: string;
  start: LocalTime;
  durationMinutes: number;
  away: boolean;
};
export type KitchenPlan = Plan & {
  ingredients: Ingredient[];
  ingredientUses: IngredientUse[];
  blockers: Blocker[];
  recipes: Recipe[];
  activityRequirements: ActivityRequirement[];
};

const numericToken = /^[+-]?(?:(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?|Infinity|NaN)$/i;

function parseFood(text: string): { name: string; quantity: number; unit: string } {
  const input = text.trim();
  if (!input) throw new Error('Enter a food name.');
  const [first, ...rest] = input.split(/\s+/);
  let quantity = 1;
  let name = input;
  if (numericToken.test(first)) {
    quantity = Number(first.replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error('Enter a positive, finite quantity.');
    name = rest.join(' ');
    if (!name) throw new Error('Enter a food name after the quantity.');
  }
  return { name, quantity, unit: '' };
}

export function parseIngredient(text: string): { name: string; quantity: number; unit: string } {
  return parseFood(text);
}

export function parsePreparedFood(text: string): { name: string; quantity: number; unit: string } {
  return parseFood(text);
}

export function ingredientTotals(plan: KitchenPlan, id: string) {
  const available = plan.ingredients.find((ingredient) => ingredient.id === id)?.quantity ?? 0;
  const assigned = plan.ingredientUses.reduce(
    (sum, use) =>
      sum + (use.ingredientId === id && Number.isFinite(use.quantity) ? use.quantity : 0),
    0
  );
  return { available, assigned, remaining: available - assigned };
}

export function setIngredientUse(
  plan: KitchenPlan,
  ingredientId: string,
  activityId: string,
  quantity: number
): KitchenPlan {
  if (!Number.isFinite(quantity) || quantity < 0)
    throw new Error('Enter a nonnegative, finite quantity.');
  if (!plan.ingredients.some((ingredient) => ingredient.id === ingredientId))
    throw new Error('Ingredient not found.');
  if (!plan.activities.some((activity) => activity.id === activityId))
    throw new Error('Activity not found.');
  const matching = (use: IngredientUse) =>
    use.ingredientId === ingredientId && use.activityId === activityId;
  const existing = plan.ingredientUses.find(matching);
  return {
    ...plan,
    ingredientUses: [
      ...plan.ingredientUses.filter((use) => !matching(use)),
      ...(quantity > 0
        ? [
            {
              id: existing?.id ?? `use-${ingredientId}-${activityId}`,
              ingredientId,
              activityId,
              quantity
            }
          ]
        : [])
    ]
  };
}

export function deleteIngredient(plan: KitchenPlan, id: string): KitchenPlan {
  return {
    ...plan,
    ingredients: plan.ingredients.filter((ingredient) => ingredient.id !== id),
    ingredientUses: plan.ingredientUses.filter((use) => use.ingredientId !== id)
  };
}

export function deleteActivity(plan: KitchenPlan, id: string): KitchenPlan {
  return {
    ...removeActivity(plan, id),
    ingredients: plan.ingredients,
    ingredientUses: plan.ingredientUses.filter((use) => use.activityId !== id),
    blockers: plan.blockers,
    recipes: plan.recipes,
    activityRequirements: plan.activityRequirements.filter((need) => need.activityId !== id)
  };
}

export function deleteBlocker(plan: KitchenPlan, id: string): KitchenPlan {
  return { ...plan, blockers: plan.blockers.filter((blocker) => blocker.id !== id) };
}

export function connectedKitchenIds(plan: KitchenPlan, rootId: string): Set<string> {
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  };
  for (const batch of plan.batches)
    if (batch.source.kind === 'activity') link(batch.source.activityId, batch.id);
  for (const allocation of plan.allocations) link(allocation.activityId, allocation.batchId);
  for (const use of plan.ingredientUses) link(use.ingredientId, use.activityId);
  const visited = new Set([rootId]);
  const queue = [rootId];
  for (let i = 0; i < queue.length; i++) {
    for (const next of edges.get(queue[i]) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function validSession(start: LocalTime, duration: number): boolean {
  try {
    parseDay(start.day);
    if (
      !Number.isSafeInteger(start.minute) ||
      start.minute < 0 ||
      start.minute >= 1440 ||
      !Number.isSafeInteger(duration) ||
      duration < 0 ||
      duration > MAX_ACTIVITY_MINUTES
    )
      return false;
    addMinutes(start, duration);
    return true;
  } catch {
    return false;
  }
}

export function moveActivity(plan: KitchenPlan, id: string, start: LocalTime): KitchenPlan {
  const activity = plan.activities.find((item) => item.id === id);
  if (!activity) throw new Error('Activity not found.');
  if (!validSession(start, activity.elapsedMinutes))
    throw new Error('Invalid activity date or time range.');
  return {
    ...plan,
    activities: plan.activities.map((item) =>
      item.id === id ? { ...item, start: { ...start } } : item
    )
  };
}

export function moveBlocker(
  plan: KitchenPlan,
  id: string,
  start: LocalTime,
  durationMinutes?: number
): KitchenPlan {
  const blocker = plan.blockers.find((item) => item.id === id);
  if (!blocker) throw new Error('Blocker not found.');
  const duration = durationMinutes ?? blocker.durationMinutes;
  if (duration <= 0 || !validSession(start, duration))
    throw new Error('Invalid blocker date or time range.');
  return {
    ...plan,
    blockers: plan.blockers.map((item) =>
      item.id === id ? { ...item, start: { ...start }, durationMinutes: duration } : item
    )
  };
}

export function validateKitchenPlan(plan: KitchenPlan): Warning[] {
  const warnings: Warning[] = [];
  const activities = new Set(plan.activities.map((activity) => activity.id));
  const ingredients = new Set(plan.ingredients.map((ingredient) => ingredient.id));
  for (const ingredient of plan.ingredients) {
    if (
      !ingredient.name.trim() ||
      !Number.isFinite(ingredient.quantity) ||
      ingredient.quantity <= 0
    )
      warnings.push({
        code: 'INVALID_INGREDIENT',
        entityIds: [ingredient.id],
        message: `Check the name and quantity for ${ingredient.id}.`
      });
  }
  for (const use of plan.ingredientUses) {
    if (!Number.isFinite(use.quantity) || use.quantity <= 0)
      warnings.push({
        code: 'INVALID_QUANTITY',
        entityIds: [use.id],
        message: 'Invalid ingredient use quantity.'
      });
    if (!ingredients.has(use.ingredientId))
      warnings.push({
        code: 'MISSING_INGREDIENT',
        entityIds: [use.id, use.ingredientId],
        message: 'Ingredient use refers to a missing ingredient.'
      });
    if (!activities.has(use.activityId))
      warnings.push({
        code: 'MISSING_ACTIVITY',
        entityIds: [use.id, use.activityId],
        message: 'Ingredient use refers to a missing activity.'
      });
  }
  for (const ingredient of plan.ingredients) {
    const { remaining } = ingredientTotals(plan, ingredient.id);
    if (Number.isFinite(remaining) && remaining < -1e-9)
      warnings.push({
        code: 'OVER_ALLOCATED_INGREDIENT',
        entityIds: [
          ingredient.id,
          ...new Set(
            plan.ingredientUses
              .filter((use) => use.ingredientId === ingredient.id)
              .map((use) => use.activityId)
          )
        ],
        message: `${ingredient.name} is over-allocated by ${-remaining}.`
      });
  }
  for (const blocker of plan.blockers) {
    if (blocker.durationMinutes <= 0 || !validSession(blocker.start, blocker.durationMinutes)) {
      warnings.push({
        code: 'INVALID_BLOCKER',
        entityIds: [blocker.id],
        message: `Check the date and duration for ${blocker.title}.`
      });
      continue;
    }
    const blockerEnd = addMinutes(blocker.start, blocker.durationMinutes);
    for (const activity of plan.activities) {
      if (!validSession(activity.start, activity.elapsedMinutes) || activity.elapsedMinutes === 0)
        continue;
      const activityEnd = addMinutes(activity.start, activity.elapsedMinutes);
      if (
        compareLocal(activity.start, blockerEnd) < 0 &&
        compareLocal(blocker.start, activityEnd) < 0
      )
        warnings.push({
          code: 'BLOCKED_TIME',
          entityIds: [activity.id, blocker.id],
          message: `${activity.title} overlaps blocked time ${blocker.title}.`
        });
    }
  }
  return [...warnings, ...validatePlan(plan)];
}

export function createKitchenPlan(anchor: Day): KitchenPlan {
  const example = createExamplePlan(anchor);
  return {
    ...example,
    activities: example.activities.map((activity) => ({
      ...activity,
      handsOnMinutes: 0,
      requiresHome: false
    })),
    batches: example.batches.map((batch) => ({ ...batch, unit: '' })),
    availability: {},
    ingredients: [
      { id: 'ing-paprika', name: 'Paprika', quantity: 2, unit: '' },
      { id: 'ing-spinach', name: 'Spinach', quantity: 200, unit: '' }
    ],
    ingredientUses: [],
    recipes: [],
    activityRequirements: [],
    blockers: [
      {
        id: 'block-climbing',
        title: 'Climbing',
        start: { day: addDays(anchor, 1), minute: 1080 },
        durationMinutes: 180,
        away: false
      },
      {
        id: 'block-evening',
        title: 'Busy evening',
        start: { day: addDays(anchor, 3), minute: 1080 },
        durationMinutes: 180,
        away: false
      }
    ]
  };
}
