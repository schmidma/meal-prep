import type { Activity, Batch, LocalTime } from './domain';
import type { ActivityRequirement, KitchenPlan, Recipe } from './kitchen';
import { parseKitchenPlan } from './plan-document';

const emptyPlan = (): KitchenPlan => ({
  activities: [],
  batches: [],
  allocations: [],
  availability: {},
  ingredients: [],
  ingredientUses: [],
  blockers: [],
  recipes: [],
  activityRequirements: []
});

export function createRecipe(id: string, name: string): Recipe {
  const recipe: Recipe = {
    id,
    name,
    yieldQuantity: 4,
    durationMinutes: 45,
    ingredients: [],
    instructions: ''
  };
  parseKitchenPlan({ ...emptyPlan(), recipes: [recipe] });
  return recipe;
}

export function instantiateRecipe(
  recipe: Recipe,
  options: {
    activityId: string;
    batchId: string;
    start: LocalTime;
    title: string;
    durationMinutes: number;
    yieldQuantity: number;
  },
  newRequirementId: () => string
): { activity: Activity; batch: Batch; requirements: ActivityRequirement[] } {
  parseKitchenPlan({ ...emptyPlan(), recipes: [recipe] });
  const activity: Activity = {
    id: options.activityId,
    title: options.title,
    kind: 'cook',
    start: { ...options.start },
    elapsedMinutes: options.durationMinutes,
    handsOnMinutes: 0,
    requiresHome: false,
    notes: recipe.instructions
  };
  const batch: Batch = {
    id: options.batchId,
    name: recipe.name,
    quantity: options.yieldQuantity,
    unit: '',
    source: { kind: 'activity', activityId: activity.id }
  };
  const requirements = recipe.ingredients.map((ingredient) => ({
    id: newRequirementId(),
    activityId: activity.id,
    name: ingredient.name,
    quantity: ingredient.quantity * (options.yieldQuantity / recipe.yieldQuantity)
  }));
  // Validate the complete result, including overflow/underflow and fresh-ID collisions.
  parseKitchenPlan({
    ...emptyPlan(),
    recipes: [recipe],
    activities: [activity],
    batches: [batch],
    activityRequirements: requirements
  });
  return { activity, batch, requirements };
}
