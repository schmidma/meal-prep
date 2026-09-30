import type { Recipe } from './kitchen';
export type UseSoonItem = { id: string; name: string; ingredientId?: string };
const groups = [
  ['bell pepper', 'capsicum', 'sweet pepper', 'peppers'],
  ['chickpea', 'garbanzo'],
  ['courgette', 'zucchini'],
  ['aubergine', 'eggplant'],
  ['coriander', 'cilantro']
];
const contains = (haystack: string, term: string) =>
  new RegExp(`\\b${term.replace(/s$/, '')}s?\\b`, 'i').test(haystack);
export function recipeMatches(recipe: Recipe, items: UseSoonItem[]): UseSoonItem[] {
  const ingredients = recipe.ingredients.map((i) => i.name.toLowerCase()).join(' ');
  return items.filter((item) => {
    if (item.ingredientId && recipe.ingredients.every((i) => i.ingredientId))
      return recipe.ingredients.some((i) => i.ingredientId === item.ingredientId);
    const clean = item.name
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\b(?:g|kg|ml|litres|cups|tins|fresh|frozen|of|a|some)\b/g, ' ')
      .trim();
    const aliases = groups.find((group) => group.some((term) => contains(clean, term)));
    if (aliases) return aliases.some((term) => contains(ingredients, term));
    const words = clean.split(/\s+/).filter((word) => word.length > 2);
    return words.length > 0 && words.every((word) => contains(ingredients, word));
  });
}
