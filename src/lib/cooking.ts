import { ingredientLine } from './ingredient-library';
import { addDays } from './calendar';
import { deleteActivity, type CookingSession, type KitchenPlan, type Recipe } from './kitchen';
import { extras, mealSlot, minuteForSlot, type MealSlot } from './planner';
import { parseKitchenPlan } from './plan-document';
import { newId } from './id';
export type ServingSlot = { id: string; day: string; slot: MealSlot; portions: number };
export function recipeNotes(recipe: Recipe, portions = recipe.yieldQuantity) {
  const shopping = shoppingForBatch(recipe, portions);
  const ingredients = recipe.ingredients
    .map((row, index) =>
      row.ingredientId && (row.unit !== undefined || row.preparation !== undefined)
        ? ingredientLine(row, portions / recipe.yieldQuantity)
        : shopping[index]
    )
    .join('\n');
  return [
    ingredients ? `Ingredients (${portions} portions)\n${ingredients}` : '',
    recipe.instructions
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function servingSlots(plan: KitchenPlan, sessionId: string): ServingSlot[] {
  return plan.activities
    .filter((a) => plan.weekly?.mealSources?.[a.id]?.sessionId === sessionId)
    .map((a) => ({
      id: a.id,
      day: a.start.day,
      slot: mealSlot(a, plan),
      portions: plan.weekly!.mealSources![a.id].portions
    }));
}
export function saveCooking(
  plan: KitchenPlan,
  session: CookingSession,
  slots: ServingSlot[],
  image: string,
  shoppingNames: string[] = []
): KitchenPlan {
  const oldSession = plan.weekly?.sessions?.find((cook) => cook.id === session.id);
  const oldSlots = servingSlots(plan, session.id);
  let next = plan;
  for (const old of oldSlots)
    if (!slots.some((slot) => slot.id === old.id)) next = deleteActivity(next, old.id);
  const weekly = extras(next);
  const styles = { ...weekly.styles };
  const images = { ...weekly.images };
  const mealSources = { ...weekly.mealSources };
  const mealSections = { ...weekly.mealSections };
  for (const old of oldSlots) {
    delete mealSources[old.id];
    delete styles[old.id];
    delete images[old.id];
  }
  if (image) images[session.id] = image;
  else delete images[session.id];
  const activities = next.activities.filter((a) => !slots.some((slot) => slot.id === a.id));
  for (const slot of slots) {
    const existing = next.activities.find((a) => a.id === slot.id);
    activities.push({
      ...(existing ?? { id: slot.id, elapsedMinutes: 30, handsOnMinutes: 0, requiresHome: false }),
      title:
        existing && oldSession && existing.title !== oldSession.name
          ? existing.title
          : session.name,
      kind: 'meal',
      start: { day: slot.day, minute: minuteForSlot(slot.slot) },
      notes:
        existing && oldSession && existing.notes !== oldSession.notes
          ? existing.notes
          : session.notes
    });
    styles[slot.id] = weekly.styles[slot.id] ?? 'leftovers';
    mealSections[slot.id] = slot.slot;
    mealSources[slot.id] = { sessionId: session.id, portions: slot.portions };
    const mealImage =
      existing && weekly.images?.[slot.id] !== weekly.images?.[session.id]
        ? weekly.images?.[slot.id]
        : image;
    if (mealImage) images[slot.id] = mealImage;
  }
  const previousShopping = weekly.shopping.filter((item) => item.cookId === session.id);
  const shopping = weekly.shopping.filter((item) => item.cookId !== session.id);
  if (
    shoppingNames.length &&
    previousShopping.length &&
    oldSession?.recipeId === session.recipeId
  ) {
    const recipe = plan.recipes.find((r) => r.id === session.recipeId);
    const oldNames = recipe && oldSession ? shoppingForBatch(recipe, oldSession.quantity) : [];
    // Update recognizable recipe amounts. Personal edits and omitted ingredients belong to the user.
    for (const previous of previousShopping) {
      const index = oldNames.indexOf(previous.name);
      const name = index >= 0 ? (shoppingNames[index] ?? previous.name) : previous.name;
      shopping.push({
        ...previous,
        name,
        checked: name === previous.name ? previous.checked : false
      });
    }
  } else {
    shoppingNames.forEach((name) =>
      shopping.push({ id: newId('shop'), name, checked: false, cookId: session.id })
    );
  }
  return parseKitchenPlan({
    ...next,
    activities,
    weekly: {
      ...weekly,
      styles,
      images,
      mealSources,
      mealSections,
      shopping,
      sessions: [...(weekly.sessions ?? []).filter((s) => s.id !== session.id), session]
    }
  });
}
/** Meals remain usable snapshots when a cooking session is removed. */
export function removeCooking(
  plan: KitchenPlan,
  sessionId: string,
  removeMeals = false
): KitchenPlan {
  if (removeMeals) {
    for (const meal of servingSlots(plan, sessionId)) plan = deleteActivity(plan, meal.id);
  }
  const weekly = extras(plan);
  const mealSources = Object.fromEntries(
    Object.entries(weekly.mealSources ?? {}).filter(([, source]) => source.sessionId !== sessionId)
  );
  const images = { ...weekly.images };
  delete images[sessionId];
  return {
    ...plan,
    weekly: {
      ...weekly,
      images,
      mealSources,
      shopping: weekly.shopping.map((item) => {
        if (item.cookId !== sessionId) return item;
        const { cookId, ...manual } = item;
        return manual;
      }),
      sessions: (weekly.sessions ?? []).filter((s) => s.id !== sessionId)
    }
  };
}
export function clearWeek(plan: KitchenPlan, week: string): KitchenPlan {
  const end = addDays(week, 7);
  let next = plan;
  for (const a of plan.activities)
    if (a.start.day >= week && a.start.day < end) next = deleteActivity(next, a.id);
  for (const session of plan.weekly?.sessions ?? [])
    if (session.day >= week && session.day < end) next = removeCooking(next, session.id);
  const ids = new Set(next.activities.map((a) => a.id));
  const weekly = extras(next);
  return {
    ...next,
    weekly: {
      ...weekly,
      styles: Object.fromEntries(Object.entries(weekly.styles).filter(([id]) => ids.has(id))),
      mealSources: Object.fromEntries(
        Object.entries(weekly.mealSources ?? {}).filter(([id]) => ids.has(id))
      )
    }
  };
}

/** Scale explicit amounts, retaining free-form ranges and seasoning instructions verbatim. */
export function shoppingForBatch(recipe: Recipe, portions: number): string[] {
  const factor = portions / recipe.yieldQuantity;
  const amount = (value: number) => Number(value.toPrecision(4)).toString();
  return recipe.ingredients.map((ingredient) => {
    if (
      ingredient.ingredientId &&
      (ingredient.unit !== undefined || ingredient.preparation !== undefined)
    )
      return ingredientLine({ ...ingredient, preparation: '' }, factor);
    const { quantity, name } = ingredient;
    if (factor === 1) return quantity === 1 ? name : `${quantity} ${name}`;
    if (quantity !== 1) return `${amount(quantity * factor)} ${name}`;
    if (/to taste|as needed|optional|a pinch|a handful|^salt$|^pepper$/i.test(name)) return name;
    const fractions: Record<string, number> = {
      '¼': 1 / 4,
      '½': 1 / 2,
      '¾': 3 / 4,
      '⅓': 1 / 3,
      '⅔': 2 / 3,
      '⅛': 1 / 8,
      '⅜': 3 / 8,
      '⅝': 5 / 8,
      '⅞': 7 / 8
    };
    const unicode = /^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])\s+(.+)$/.exec(name);
    if (unicode)
      return `${amount((Number(unicode[1] ?? 0) + fractions[unicode[2]]) * factor)} ${unicode[3]}`;
    // The recipe editor also accepts an entire ingredient line as natural text.
    const match = /^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s+(.+)$/.exec(name);
    if (match) {
      const value = match[1].split(/\s+/).reduce((total, part) => {
        const [numerator, denominator] = part.split('/').map(Number);
        return total + numerator / (denominator ?? 1);
      }, 0);
      if (Number.isFinite(value) && value > 0) return `${amount(value * factor)} ${match[2]}`;
      return name;
    }
    // Ranges and other nonstandard numeric expressions need the cook's judgement.
    if (/^[\d¼½¾]/.test(name)) return name;
    return name;
  });
}
