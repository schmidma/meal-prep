import type { IngredientDefinition } from '../../src/lib/ingredient-library';
import type { KitchenPlan, Recipe } from '../../src/lib/kitchen';
import { emptyKitchen } from '../../src/lib/planner';
import { addDays } from '../../src/lib/calendar';
import { recipeNotes, saveCooking } from '../../src/lib/cooking';

const seeds: [string, string[]][] = [
  ['Chickpeas', ['chickpea', 'garbanzo beans', 'garbanzo']],
  ['Courgette', ['zucchini', 'courgettes']],
  ['Aubergine', ['eggplant', 'aubergines']],
  ['Bell pepper', ['bell peppers', 'capsicum', 'sweet pepper']],
  ['Onion', ['onions']],
  ['Tomato', ['tomatoes']],
  ['Lemon', ['lemons']],
  ['Sweet potato', ['sweet potatoes']],
  ['Spinach', []]
];
export const starterIngredients = (): IngredientDefinition[] =>
  seeds.map(([name, aliases], i) => ({
    id: `ingredient-common-${i}`,
    name: name.toLowerCase(),
    aliases: [...aliases]
  }));

export function createPlaygroundRecipes(): Recipe[] {
  const recipe = (
    id: string,
    name: string,
    minutes: number,
    ingredients: [number, string][],
    instructions: string
  ): Recipe => ({
    id,
    name,
    yieldQuantity: 4,
    durationMinutes: minutes,
    ingredients: ingredients.map(([quantity, name], index) => ({
      id: `${id}-ingredient-${index}`,
      quantity,
      name: quantity === 1 ? `1 ${name}` : name
    })),
    instructions
  });
  return [
    recipe(
      'recipe-curry',
      'Chickpea & spinach curry',
      35,
      [
        [2, 'tins chickpeas'],
        [1, 'onion'],
        [400, 'ml coconut milk'],
        [2, 'tbsp curry paste'],
        [200, 'g spinach'],
        [300, 'g basmati rice']
      ],
      '1. Soften the chopped onion in a little oil. Stir in the curry paste.\n2. Add the drained chickpeas and coconut milk. Simmer for 15 minutes.\n3. Cook the rice. Fold the spinach into the curry until wilted.\n4. Serve with rice and pack the extra portions for another meal.'
    ),
    recipe(
      'recipe-pasta',
      'Lemon & pea pasta',
      20,
      [
        [400, 'g pasta'],
        [200, 'g frozen peas'],
        [100, 'g spinach'],
        [1, 'lemon'],
        [60, 'g parmesan'],
        [2, 'tbsp olive oil']
      ],
      '1. Cook the pasta, adding the peas for the final 2 minutes. Save a mug of pasta water.\n2. Toss with olive oil, lemon zest and juice, spinach and parmesan.\n3. Add a splash of pasta water until glossy. Season to taste.'
    ),
    recipe(
      'recipe-soup',
      'Roasted tomato soup',
      45,
      [
        [1, 'kg tomatoes'],
        [1, 'onion'],
        [3, 'cloves garlic'],
        [500, 'ml vegetable stock'],
        [1, 'bunch basil'],
        [1, 'loaf sourdough']
      ],
      '1. Roast halved tomatoes, onion and garlic with olive oil at 200°C for 30 minutes.\n2. Blend with hot stock until smooth, then warm through.\n3. Finish with basil and serve with toasted sourdough.'
    ),
    recipe(
      'recipe-bowls',
      'Roasted vegetable bowls',
      40,
      [
        [2, 'sweet potatoes'],
        [1, 'head broccoli'],
        [2, 'bell peppers'],
        [1, 'tin chickpeas'],
        [250, 'g quinoa'],
        [3, 'tbsp tahini'],
        [1, 'lemon']
      ],
      '1. Toss sweet potato, broccoli, peppers and drained chickpeas with oil and seasoning. Roast at 200°C for 25–30 minutes.\n2. Cook the quinoa. Mix tahini with lemon juice and a little water.\n3. Divide everything into bowls, keeping the dressing separate for packed lunches.'
    )
  ];
}
export function createPlaygroundPlan(week: string): KitchenPlan {
  const recipes = createPlaygroundRecipes();
  let plan: KitchenPlan = {
    ...emptyKitchen(),
    recipes,
    weekly: {
      ingredientLibrary: starterIngredients(),
      shopping: [
        { id: 'shop-lemons', name: 'Lemons', checked: false },
        { id: 'shop-bread', name: 'Sourdough', checked: false },
        { id: 'shop-spinach', name: 'Spinach', checked: true }
      ],
      styles: {},
      images: {
        'recipe-curry': 'chickpea-curry',
        'recipe-pasta': 'lemon-pasta',
        'recipe-soup': 'tomato-soup',
        'recipe-bowls': 'roasted-vegetables',
        'leftover-soup': 'tomato-soup'
      }
    },
    batches: [
      {
        id: 'leftover-soup',
        name: 'Roasted tomato soup',
        quantity: 2,
        unit: 'portions',
        source: { kind: 'existing', availableAt: { day: addDays(week, -1), minute: 0 } }
      }
    ]
  };
  plan = saveCooking(
    plan,
    {
      id: 'cook-curry-demo',
      name: recipes[0].name,
      day: week,
      quantity: 4,
      notes: recipeNotes(recipes[0]),
      recipeId: recipes[0].id
    },
    [
      { id: 'curry-dinner-demo', day: week, slot: 'Dinner', portions: 2 },
      { id: 'curry-lunch-demo', day: addDays(week, 1), slot: 'Lunch', portions: 2 }
    ],
    'chickpea-curry'
  );
  plan = saveCooking(
    plan,
    {
      id: 'cook-bowls-demo',
      name: recipes[3].name,
      day: addDays(week, 2),
      quantity: 6,
      notes: recipeNotes(recipes[3], 6),
      recipeId: recipes[3].id
    },
    [
      { id: 'bowls-dinner-demo', day: addDays(week, 2), slot: 'Dinner', portions: 2 },
      { id: 'bowls-lunch-demo', day: addDays(week, 3), slot: 'Lunch', portions: 2 }
    ],
    'roasted-vegetables'
  );
  plan.activities.push({
    id: 'friday-out-demo',
    title: 'Dinner with friends',
    kind: 'meal',
    start: { day: addDays(week, 4), minute: 1110 },
    elapsedMinutes: 30,
    handsOnMinutes: 0,
    requiresHome: false,
    notes: 'Leave the evening open.'
  });
  plan.weekly!.styles['friday-out-demo'] = 'easy';
  return plan;
}

export function createStarterPlan(): KitchenPlan {
  const recipes = createPlaygroundRecipes();
  return {
    ...emptyKitchen(),
    recipes,
    weekly: {
      ingredientLibrary: starterIngredients(),
      shopping: [],
      styles: {},
      useSoon: [],
      sessions: [],
      mealSources: {},
      images: {
        'recipe-curry': 'chickpea-curry',
        'recipe-pasta': 'lemon-pasta',
        'recipe-soup': 'tomato-soup',
        'recipe-bowls': 'roasted-vegetables'
      }
    }
  };
}
