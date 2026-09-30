import { emptyKitchen } from './planner';
import { describe, it, expect } from 'vitest';
import { createStarterPlan } from '../../tests/fixtures/plans';
import {
  removeIngredient,
  ingredientInUse,
  linkIngredients,
  findIngredient,
  updateIngredient,
  mergeIngredients,
  parseIngredientLine,
  parseRecipeIngredientLine,
  ingredientLine,
  recipeIngredientSearch,
  recipeHasIngredients
} from './ingredient-library';
import { recipeMatches } from './use-soon';
import { parseKitchenPlan } from './plan-document';
import { shoppingForBatch } from './cooking';
describe('ingredient identities', () => {
  it('upgrades existing recipes without losing amounts and remains stable', () => {
    const old = createStarterPlan();
    const plan = linkIngredients(old);
    expect(parseKitchenPlan(plan)).toEqual(plan);
    expect(linkIngredients(plan)).toEqual(plan);
    expect(shoppingForBatch(plan.recipes[0], 8)).toContain('4 tins chickpeas');
    expect(
      plan.recipes[0].ingredients.find((i) => i.name === 'chickpeas')?.ingredientId
    ).toBeTruthy();
  });
  it('matches aliases by identity without confusing paprika and peppers', () => {
    const old = createStarterPlan();
    old.weekly!.useSoon = [
      { id: 'soon', name: 'garbanzo beans' },
      { id: 'spice', name: 'paprika' }
    ];
    const plan = linkIngredients(old);
    expect(recipeMatches(plan.recipes[0], plan.weekly!.useSoon!)).toEqual([
      plan.weekly!.useSoon![0]
    ]);
    expect(
      recipeMatches(
        plan.recipes.find((i) => i.id === 'recipe-bowls')!,
        [plan.weekly!.useSoon![1]]
      )
    ).toEqual([]);
  });
  it('renames and merges all references, retains amounts and deduplicates reminders', () => {
    const old = createStarterPlan();
    old.weekly!.useSoon = [
      { id: 'a', name: 'garbanzo beans' },
      { id: 'b', name: 'Cicer beans' }
    ];
    let plan = linkIngredients(old);
    const item = findIngredient(plan.weekly!.ingredientLibrary!, 'chickpeas')!;
    plan = updateIngredient(plan, { ...item, name: 'Garbanzo beans', aliases: ['Chickpeas'] });
    expect(plan.recipes[0].ingredients.some((i) => i.name === 'Garbanzo beans')).toBe(true);
    const duplicate = findIngredient(plan.weekly!.ingredientLibrary!, 'Cicer beans')!;
    plan = mergeIngredients(plan, duplicate.id, item.id);
    expect(plan.weekly!.useSoon).toHaveLength(1);
    expect(findIngredient(plan.weekly!.ingredientLibrary!, 'Cicer beans')?.id).toBe(item.id);
    expect(parseKitchenPlan(plan)).toEqual(plan);
  });
  it('rejects duplicate aliases and missing references', () => {
    const plan = linkIngredients(createStarterPlan());
    const item = plan.weekly!.ingredientLibrary![0];
    expect(() => updateIngredient(plan, { ...item, aliases: ['onion'] })).toThrow();
    const bad = structuredClone(plan);
    bad.recipes[0].ingredients[0].ingredientId = 'missing';
    expect(() => parseKitchenPlan(bad)).toThrow();
  });
  it('separates quantities, units and preparation, including fractions', () => {
    const row = parseIngredientLine('2 1/2 cups chickpeas, drained');
    expect(row).toMatchObject({
      quantity: 2.5,
      unit: 'cups',
      name: 'chickpeas',
      preparation: 'drained'
    });
    expect(ingredientLine(row, 2)).toBe('5 cups chickpeas, drained');
    expect(parseIngredientLine('½ lemon').quantity).toBe(0.5);
    expect(parseIngredientLine('1½ cups stock').quantity).toBe(1.5);
  });
});

it('does not invent amounts for unquantified or ranged legacy ingredients', () => {
  const plan = createStarterPlan();
  plan.recipes[0].ingredients = [
    { id: 'salt', name: 'salt', quantity: 1 },
    { id: 'range', name: '1–2 onions', quantity: 1 }
  ];
  const upgraded = linkIngredients(plan);
  expect(shoppingForBatch(upgraded.recipes[0], 8)).toEqual(['salt', '1–2 onions']);
  expect(parseKitchenPlan(upgraded)).toEqual(upgraded);
});

it('preserves recipe prose and scales only explicit amounts', () => {
  const plan = createStarterPlan();
  plan.recipes[0].ingredients = [
    'salt, to taste',
    '200g spinach',
    '1–2 onions',
    '2 x 400g tomatoes'
  ].map((line) => parseRecipeIngredientLine(line));
  const linked = linkIngredients(plan);
  expect(linkIngredients(linked)).toEqual(linked);
  expect(linked.recipes[0].ingredients.map((row) => ingredientLine(row))).toEqual([
    'salt, to taste',
    '200 g spinach',
    '1–2 onions',
    '2 x 400g tomatoes'
  ]);
  expect(shoppingForBatch(linked.recipes[0], linked.recipes[0].yieldQuantity * 2)).toContain(
    'salt'
  );
  expect(shoppingForBatch(linked.recipes[0], linked.recipes[0].yieldQuantity * 2)).toContain(
    '400 g spinach'
  );
});

it('matches all ingredient filters with aliases and multiword names while retaining name search', () => {
  const plan = linkIngredients(createStarterPlan());
  const library = plan.weekly!.ingredientLibrary!;
  const curry = plan.recipes.find((recipe) => recipe.id === 'recipe-curry')!;
  const bowls = plan.recipes.find((recipe) => recipe.id === 'recipe-bowls')!;
  expect(recipeHasIngredients(curry, library, ['garbanzo beans', 'spinach'])).toBe(true);
  expect(recipeHasIngredients(curry, library, ['spinach', 'tomato'])).toBe(false);
  expect(recipeHasIngredients(bowls, library, ['capsicum', 'sweet potato'])).toBe(true);
  expect(recipeHasIngredients(curry, library, [' CHICKPEAS ', 'spinach'])).toBe(true);
  expect(recipeHasIngredients(curry, library, ['curry'])).toBe(true);
  expect(recipeHasIngredients(curry, library, ['Chickpea & spinach curry'])).toBe(false);
  expect(recipeIngredientSearch(curry, library, 'Chickpea & spinach curry')).toBe(true);
  expect(recipeHasIngredients(curry, library, [])).toBe(true);
});

it('treats spacing and hyphens as the same ingredient and merges old references', () => {
  const plan = createStarterPlan();
  plan.weekly!.ingredientLibrary = [
    { id: 'rice-a', name: 'Risotto Reis', aliases: [] },
    { id: 'rice-b', name: 'Risotto-Reis', aliases: [] }
  ];
  plan.weekly!.useSoon = [{ id: 'soon', name: 'Risotto-Reis', ingredientId: 'rice-b' }];
  const linked = linkIngredients(plan);
  for (const name of ['Risotto Reis', 'Risottoreis', 'Risotto-Reis']) {
    expect(findIngredient(linked.weekly!.ingredientLibrary!, name)?.id).toBe('rice-a');
  }
  expect(linked.weekly!.useSoon![0].ingredientId).toBe('rice-a');
  expect(linkIngredients(linked)).toEqual(linked);
});

it('recognizes German quantity units without translating ingredient content', () => {
  expect(parseRecipeIngredientLine('2 Dosen Kichererbsen, abgetropft')).toMatchObject({
    quantity: 2,
    unit: 'Dosen',
    name: 'Kichererbsen',
    preparation: 'abgetropft'
  });
  expect(parseRecipeIngredientLine('1,5 EL Olivenöl')).toMatchObject({
    quantity: 1.5,
    unit: 'EL',
    name: 'Olivenöl'
  });
});

it('starts empty and learns only ingredients supplied by the household', () => {
  const empty = linkIngredients(emptyKitchen());
  expect(empty.weekly!.ingredientLibrary).toEqual([]);
  expect(linkIngredients(empty)).toEqual(empty);
  empty.weekly!.useSoon = [{ id: 'soon', name: 'Paprika' }];
  const populated = linkIngredients(empty);
  expect(populated.weekly!.ingredientLibrary!.map((item) => item.name)).toEqual(['Paprika']);
});

it('deletes unused ingredients and aliases without recreating them on reload', () => {
  const plan = linkIngredients(emptyKitchen());
  plan.weekly!.ingredientLibrary = [{ id: 'unused', name: 'Courgette', aliases: ['zucchini'] }];
  const deleted = removeIngredient(plan, 'unused');
  expect(linkIngredients(parseKitchenPlan(deleted)).weekly!.ingredientLibrary).toEqual([]);
  expect(plan.weekly!.ingredientLibrary).toHaveLength(1);
});

it.each(['recipe', 'useSoon', 'shopping'])('protects ingredients used by %s', (source) => {
  const plan = linkIngredients(emptyKitchen());
  plan.weekly!.ingredientLibrary = [{ id: 'used', name: 'Paprika', aliases: [] }];
  if (source === 'recipe')
    plan.recipes = [
      {
        id: 'recipe',
        name: 'Soup',
        yieldQuantity: 2,
        durationMinutes: 20,
        ingredients: [{ id: 'row', name: 'Paprika', quantity: 1, ingredientId: 'used' }],
        instructions: ''
      }
    ];
  if (source === 'useSoon')
    plan.weekly!.useSoon = [{ id: 'row', name: 'Paprika', ingredientId: 'used' }];
  if (source === 'shopping')
    plan.weekly!.shopping = [{ id: 'row', name: 'Paprika', checked: false, ingredientId: 'used' }];
  expect(ingredientInUse(plan, 'used')).toBe(true);
  expect(() => removeIngredient(plan, 'used')).toThrow('still in use');
});
