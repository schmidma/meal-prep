import { removeActivity, type Plan, type Day, type LocalTime } from './domain';

export type RecipeIngredient = {
  id: string;
  name: string;
  quantity: number;
  ingredientId?: string;
  unit?: string;
  preparation?: string;
};
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
export type MealStyle = 'cook' | 'leftovers' | 'easy';
export type CookingSession = {
  id: string;
  name: string;
  day: Day;
  quantity: number;
  notes: string;
  recipeId: string;
};
export type WeeklyExtras = {
  settings?: import('./planning-settings').PlanningSettings;
  mealSections?: Record<string, string>;
  ingredientLibrary?: import('./ingredient-library').IngredientDefinition[];
  useSoon?: { id: string; name: string; ingredientId?: string }[];
  sessions?: CookingSession[];
  leftoverSources?: Record<string, { batchId: string; portions: number }>;
  mealSources?: Record<string, { sessionId: string; portions: number }>;
  images?: Record<string, string>;
  shopping: {
    id: string;
    name: string;
    checked: boolean;
    cookId?: string;
    ingredientId?: string;
  }[];
  styles: Record<string, MealStyle>;
};
export type KitchenPlan = Plan & {
  weekly?: WeeklyExtras;
  ingredients: Ingredient[];
  ingredientUses: IngredientUse[];
  blockers: Blocker[];
  recipes: Recipe[];
  activityRequirements: ActivityRequirement[];
};

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
