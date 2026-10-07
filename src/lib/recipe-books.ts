import type { KitchenPlan, Recipe } from './kitchen';
import { extras } from './planner';
import { findIngredient } from './ingredient-library';

export type BookAccess = 'owner' | 'contribute' | 'view';
export type RecipeBook = { id: string; name: string; access: BookAccess };
export type BookRecipe = { bookId: string; revision: number; recipe: Recipe; image: string };
export type RecipeCatalog = { books: RecipeBook[]; defaultBookId: string; recipes: BookRecipe[] };
export const emptyCatalog = (): RecipeCatalog => ({ books: [], defaultBookId: '', recipes: [] });
export const snapshotId = (entry: BookRecipe) =>
  `${entry.bookId}:${entry.recipe.id}:${entry.revision}`;

// Ingredient identities belong to a household. Match names/aliases without importing another
// household's IDs; new identities are created only when a recipe is actually planned.
export function catalogRecipes(catalog: RecipeCatalog, plan: KitchenPlan): Recipe[] {
  return catalog.recipes.map((entry) => ({
    ...entry.recipe,
    id: snapshotId(entry),
    ingredients: entry.recipe.ingredients.map(({ ingredientId: _id, ...original }, index) => {
      const row = { ...original, id: `${snapshotId(entry)}:ingredient-${index}` };
      const match = findIngredient(plan.weekly?.ingredientLibrary ?? [], row.name);
      return match ? { ...row, name: match.name, ingredientId: match.id } : row;
    })
  }));
}
export function planningCatalog(plan: KitchenPlan, catalog: RecipeCatalog): KitchenPlan {
  const recipes = catalogRecipes(catalog, plan);
  const ids = new Set(recipes.map((r) => r.id));
  return {
    ...plan,
    recipes: [...plan.recipes.filter((r) => !ids.has(r.id)), ...recipes],
    weekly: {
      ...extras(plan),
      images: {
        ...plan.weekly?.images,
        ...Object.fromEntries(
          catalog.recipes.filter((r) => r.image).map((r) => [snapshotId(r), r.image])
        )
      }
    }
  };
}
/** Keep only recipe snapshots used by a cooking session or leftover batch. */
export function retainPlannedRecipes(plan: KitchenPlan): KitchenPlan {
  const used = new Set([
    ...(plan.weekly?.sessions ?? []).map((s) => s.recipeId),
    ...plan.batches.map((b) => b.recipeId)
  ]);
  const discarded = new Set(plan.recipes.filter((r) => !used.has(r.id)).map((r) => r.id));
  return {
    ...plan,
    recipes: plan.recipes.filter((r) => used.has(r.id)),
    ...(plan.weekly
      ? {
          weekly: {
            ...plan.weekly,
            images: Object.fromEntries(
              Object.entries(plan.weekly.images ?? {}).filter(([id]) => !discarded.has(id))
            )
          }
        }
      : {})
  };
}
