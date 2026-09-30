import type { Activity } from './domain';
import type { KitchenPlan, MealStyle } from './kitchen';

export const mealSlots = ['Breakfast', 'Lunch', 'Dinner'] as const;
export type MealSlot = string;
export const slotMinute: Record<MealSlot, number> = { Breakfast: 480, Lunch: 750, Dinner: 1110 };
export function mealSlot(activity: Activity, plan?: KitchenPlan): MealSlot {
  const section = plan?.weekly?.mealSections?.[activity.id];
  if (section) return section;
  return activity.start.minute < 660
    ? 'Breakfast'
    : activity.start.minute < 960
      ? 'Lunch'
      : 'Dinner';
}
export const minuteForSlot = (slot: MealSlot) => slotMinute[slot] ?? 750;
export function mealStyle(plan: KitchenPlan, activity: Activity): MealStyle {
  return (
    plan.weekly?.styles[activity.id] ??
    (activity.kind === 'cook'
      ? 'cook'
      : plan.allocations.some((a) => a.activityId === activity.id && a.purpose === 'eat')
        ? 'leftovers'
        : 'easy')
  );
}
export function emptyKitchen(): KitchenPlan {
  return {
    activities: [],
    batches: [],
    allocations: [],
    availability: {},
    ingredients: [],
    ingredientUses: [],
    blockers: [],
    recipes: [],
    activityRequirements: []
  };
}
export function extras(plan: KitchenPlan) {
  return plan.weekly ?? { shopping: [], styles: {} };
}
