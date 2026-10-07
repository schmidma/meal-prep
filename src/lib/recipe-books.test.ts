import { expect, it } from 'vitest';
import {
  catalogRecipes,
  planningCatalog,
  retainPlannedRecipes,
  type RecipeCatalog
} from './recipe-books';
import { saveCooking } from './cooking';
import { emptyKitchen } from './planner';
import { linkIngredients } from './ingredient-library';
import { parseKitchenPlan } from './plan-document';

it('plans two versions of a recipe without identifier collisions or changing the first snapshot', () => {
  const catalog: RecipeCatalog = {
    books: [{ id: 'book', name: 'Book', access: 'contribute' }],
    defaultBookId: 'book',
    recipes: [
      {
        bookId: 'book',
        revision: 1,
        image: 'sketch-soup',
        recipe: {
          id: 'recipe',
          name: 'Soup',
          durationMinutes: 30,
          instructions: '',
          yieldQuantity: 4,
          ingredients: [{ id: 'row', name: 'Carrots', quantity: 4, unit: '' }]
        }
      }
    ]
  };
  let available = linkIngredients(planningCatalog(emptyKitchen(), catalog));
  const first = catalogRecipes(catalog, available)[0];
  let plan = saveCooking(
    available,
    {
      id: 'first-cook',
      name: 'Soup',
      quantity: 4,
      day: '2026-10-04',
      recipeId: first.id,
      notes: ''
    },
    [],
    'sketch-soup'
  );
  catalog.recipes[0].revision = 2;
  catalog.recipes[0].recipe.ingredients[0].quantity = 8;
  available = linkIngredients(planningCatalog(plan, catalog));
  const second = catalogRecipes(catalog, available)[0];
  plan = saveCooking(
    available,
    {
      id: 'second-cook',
      name: 'Soup',
      quantity: 4,
      day: '2026-10-05',
      recipeId: second.id,
      notes: ''
    },
    [],
    'sketch-soup'
  );
  expect(() => parseKitchenPlan(plan)).not.toThrow();
  expect(plan.recipes.find((r) => r.id === first.id)?.ingredients[0].quantity).toBe(4);
  expect(plan.recipes.find((r) => r.id === second.id)?.ingredients[0].quantity).toBe(8);
  expect(retainPlannedRecipes(plan).recipes).toHaveLength(2);
});
