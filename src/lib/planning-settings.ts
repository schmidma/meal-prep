import { addDays, parseDay } from './calendar';
import type { KitchenPlan } from './kitchen';
import { mealSlot } from './planner';
export type MealSection = { id: string; name: string; enabled: boolean };
export type PlanningSettings = {
  startDay: 'today' | number;
  daysShown: number;
  portions: number;
  sections: MealSection[];
};
export function planningSettings(plan: KitchenPlan): PlanningSettings {
  return (
    plan.weekly?.settings ?? {
      startDay: 1,
      daysShown: 7,
      portions: 2,
      sections: ['Breakfast', 'Lunch', 'Dinner'].map((name) => ({
        id: name,
        name,
        enabled: name !== 'Breakfast'
      }))
    }
  );
}
export function planningStart(today: string, settings: PlanningSettings) {
  if (settings.startDay === 'today') return today;
  return addDays(today, -((parseDay(today).getDay() - settings.startDay + 7) % 7));
}
export function visibleSections(plan: KitchenPlan, days: string[]) {
  return planningSettings(plan).sections.filter(
    (section) =>
      section.enabled ||
      plan.activities.some(
        (activity) => days.includes(activity.start.day) && mealSlot(activity, plan) === section.id
      )
  );
}
export function validateSettings(settings: PlanningSettings) {
  if (
    settings.startDay !== 'today' &&
    (!Number.isInteger(settings.startDay) || settings.startDay < 0 || settings.startDay > 6)
  )
    throw new Error('Choose a starting day.');
  if (!Number.isSafeInteger(settings.daysShown) || settings.daysShown < 1)
    throw new Error('Enter a whole number of days greater than zero.');
  if (!Number.isFinite(settings.portions) || settings.portions < 0.5 || settings.portions > 999)
    throw new Error('Choose between 0.5 and 999 portions.');
  if (!settings.sections.some((section) => section.enabled))
    throw new Error('Keep at least one meal section enabled.');
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const section of settings.sections) {
    const key = section.name.trim().toLocaleLowerCase();
    if (!key || section.name.length > 60)
      throw new Error('Give each section a name of up to 60 characters.');
    if (names.has(key) || ids.has(section.id))
      throw new Error('Each section needs a different name.');
    names.add(key);
    ids.add(section.id);
  }
  for (const id of ['Breakfast', 'Lunch', 'Dinner'])
    if (!ids.has(id)) throw new Error('Keep the standard sections; disable them when not needed.');
}
