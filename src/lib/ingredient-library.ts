import { newId } from './id';
import type { KitchenPlan, RecipeIngredient } from './kitchen';
export type IngredientDefinition = { id: string; name: string; aliases: string[] };
export const ingredientKey = (name: string) =>
  name
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\p{Dash_Punctuation}]+/gu, '');
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
export function findIngredient(library: IngredientDefinition[], name: string) {
  const key = ingredientKey(name);
  return library.find((i) => [i.name, ...i.aliases].some((n) => ingredientKey(n) === key));
}
export function suggestIngredients(library: IngredientDefinition[], query: string) {
  const key = ingredientKey(query);
  return library
    .filter((i) => [i.name, ...i.aliases].some((n) => ingredientKey(n).includes(key)))
    .slice(0, 8);
}
export function ensureIngredient(library: IngredientDefinition[], name: string) {
  const found = findIngredient(library, name);
  if (found) return found;
  const item = { id: newId('ingredient'), name: name.trim(), aliases: [] };
  library.push(item);
  return item;
}
const fractions: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125
};
export function parseAmount(value: string): number | undefined {
  const text = value
    .trim()
    .replace(',', '.')
    .replace(/(\d)([½¼¾⅓⅔⅛])/g, '$1 $2');
  if (!text) return undefined;
  const parts = text.split(/\s+/);
  let result = 0;
  for (const part of parts) {
    if (fractions[part]) result += fractions[part];
    else if (/^\d+\/\d+$/.test(part)) {
      const [a, b] = part.split('/').map(Number);
      if (!b) return undefined;
      result += a / b;
    } else if (/^\d+(\.\d+)?$/.test(part)) result += Number(part);
    else return undefined;
  }
  return result > 0 && Number.isFinite(result) ? result : undefined;
}
export function parseIngredientLine(
  text: string,
  rowId: string = newId('recipe-ingredient')
): RecipeIngredient {
  let name = text.trim();
  let quantity = 1;
  let unit = '';
  let preparation = '';
  const prefix = /^(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+|[½¼¾⅓⅔⅛])?|\d+\/\d+|[½¼¾⅓⅔⅛])\s+(.+)$/.exec(name);
  if (prefix) {
    quantity = parseAmount(prefix[1]) ?? 1;
    name = prefix[2];
  }
  const units =
    /^(g|kg|ml|l|litres?|liters?|cups?|tins?|cans?|tbsp|tsp|cloves?|bunch(?:es)?|heads?|loaf|loaves|dosen?|stück(?:e)?|el|tl|esslöffel|teelöffel|zehen?|bund|kopf|köpfe|scheiben?|becher|packung(?:en)?|päckchen|tassen?)\s+(.+)$/i.exec(
      name
    );
  if (units) {
    unit = units[1];
    name = units[2];
  }
  const comma = name.indexOf(',');
  if (comma > 0) {
    preparation = name.slice(comma + 1).trim();
    name = name.slice(0, comma).trim();
  }
  return { id: rowId, name, quantity, unit, preparation };
}
/** Recipe prose may intentionally omit an amount. */
export function parseRecipeIngredientLine(
  text: string,
  id: string = newId('recipe-ingredient')
): RecipeIngredient {
  const spaced = text.trim().replace(/^(\d+(?:[.,]\d+)?)(kg|g|ml|l)\s+/i, '$1 $2 ');
  const parsed = parseIngredientLine(spaced, id);
  if (/^[\d½¼¾⅓⅔⅛]/.test(parsed.name) || /^x\s+\d/i.test(parsed.name))
    return { id, name: text.trim(), quantity: 1 };
  if (!/^[\d½¼¾⅓⅔⅛]/.test(spaced)) return { ...parsed, unit: undefined };
  return parsed;
}
export function ingredientLine(i: RecipeIngredient, factor = 1) {
  const amount = Number((i.quantity * factor).toPrecision(4));
  return `${i.unit === undefined ? '' : `${amount} `}${i.unit ? `${i.unit} ` : ''}${i.name}${i.preparation ? `, ${i.preparation}` : ''}`;
}
/** Idempotent upgrade. No substring/ambiguous alias guessing. */
export function linkIngredients(input: KitchenPlan): KitchenPlan {
  const existing = input.weekly?.ingredientLibrary ?? [];
  for (let i = 0; i < existing.length; i++) {
    const duplicate = existing
      .slice(0, i)
      .find((item) =>
        [item.name, ...item.aliases].some((name) =>
          [existing[i].name, ...existing[i].aliases].some(
            (other) => ingredientKey(name) === ingredientKey(other)
          )
        )
      );
    if (duplicate) return mergeIngredients(input, existing[i].id, duplicate.id);
  }
  const library = (input.weekly?.ingredientLibrary ?? starterIngredients()).map((i) => ({
    ...i,
    aliases: [...i.aliases]
  }));
  const recipes = input.recipes.map((recipe) => ({
    ...recipe,
    ingredients: recipe.ingredients.map((row) => {
      const known = library.find((i) => i.id === row.ingredientId);
      if (known) return { ...row, name: known.name };
      if (
        row.unit === undefined &&
        row.preparation === undefined &&
        row.quantity === 1 &&
        (/^\d+[–-]\d/.test(row.name) || /^\d+\s+x\s+\d/i.test(row.name))
      )
        return row;
      const parsed =
        row.unit !== undefined || row.preparation !== undefined
          ? row
          : parseIngredientLine(
              row.quantity === 1 ? row.name : `${row.quantity} ${row.name}`,
              row.id
            );
      if (
        row.unit === undefined &&
        row.quantity === 1 &&
        parsed.name === row.name &&
        !parsed.unit &&
        !parsed.preparation &&
        row.preparation === undefined
      ) {
        // Keep unquantified and unrecognized legacy amounts verbatim rather than inventing one.
        if (/^[\d½¼¾⅓⅔⅛]/.test(row.name)) return row;
        const ingredient = ensureIngredient(library, row.name);
        return { ...row, name: ingredient.name, ingredientId: ingredient.id };
      }
      const ingredient = ensureIngredient(library, parsed.name);
      return { ...parsed, name: ingredient.name, ingredientId: ingredient.id };
    })
  }));
  const useSoon = (input.weekly?.useSoon ?? [])
    .map((row) => {
      const ingredient =
        library.find((i) => i.id === row.ingredientId) ?? ensureIngredient(library, row.name);
      return { ...row, name: ingredient.name, ingredientId: ingredient.id };
    })
    .filter(
      (row, index, rows) =>
        rows.findIndex((other) => other.ingredientId === row.ingredientId) === index
    );
  return {
    ...input,
    recipes,
    weekly: {
      styles: {},
      ...input.weekly,
      ingredientLibrary: library,
      useSoon,
      shopping: (input.weekly?.shopping ?? []).map((row) => {
        const ingredient =
          library.find((i) => i.id === row.ingredientId) ??
          findIngredient(library, parseIngredientLine(row.name).name);
        const { ingredientId: _old, ...rest } = row;
        return ingredient ? { ...rest, ingredientId: ingredient.id } : rest;
      })
    }
  };
}
export function updateIngredient(plan: KitchenPlan, item: IngredientDefinition): KitchenPlan {
  item = {
    ...item,
    aliases: item.aliases.filter(
      (name, index, aliases) =>
        ingredientKey(name) &&
        ingredientKey(name) !== ingredientKey(item.name) &&
        aliases.findIndex((other) => ingredientKey(other) === ingredientKey(name)) === index
    )
  };
  const keys = [item.name, ...item.aliases].map(ingredientKey);
  if (!item.name.trim() || keys.some((k) => !k) || new Set(keys).size !== keys.length)
    throw new Error('Use a name and distinct aliases.');
  const library = plan.weekly?.ingredientLibrary ?? [];
  if (
    library.some(
      (i) => i.id !== item.id && [i.name, ...i.aliases].some((n) => keys.includes(ingredientKey(n)))
    )
  )
    throw new Error('That name already belongs to another ingredient. Merge them instead.');
  return linkIngredients({
    ...plan,
    weekly: {
      ...plan.weekly!,
      ingredientLibrary: library.map((i) => (i.id === item.id ? item : i))
    }
  });
}
export function mergeIngredients(plan: KitchenPlan, fromId: string, intoId: string): KitchenPlan {
  const library = plan.weekly?.ingredientLibrary ?? [];
  const source = library.find((i) => i.id === fromId);
  const target = library.find((i) => i.id === intoId);
  if (!source || !target || source.id === target.id)
    throw new Error('Choose a different ingredient.');
  const aliases = [...target.aliases, source.name, ...source.aliases].filter(
    (n, index, all) =>
      ingredientKey(n) !== ingredientKey(target.name) &&
      all.findIndex((x) => ingredientKey(x) === ingredientKey(n)) === index
  );
  return linkIngredients({
    ...plan,
    recipes: plan.recipes.map((r) => ({
      ...r,
      ingredients: r.ingredients.map((i) =>
        i.ingredientId === fromId ? { ...i, ingredientId: intoId } : i
      )
    })),
    weekly: {
      ...plan.weekly!,
      shopping: plan.weekly!.shopping.map((i) =>
        i.ingredientId === fromId ? { ...i, ingredientId: intoId } : i
      ),
      ingredientLibrary: library
        .filter((i) => i.id !== fromId)
        .map((i) => (i.id === intoId ? { ...i, aliases } : i)),
      useSoon: plan.weekly?.useSoon?.map((i) =>
        i.ingredientId === fromId ? { ...i, ingredientId: intoId } : i
      )
    }
  });
}

export function recipeHasIngredients(
  recipe: import('./kitchen').Recipe,
  library: IngredientDefinition[],
  ingredients: string[]
) {
  const names = recipe.ingredients.flatMap((row) => {
    const item = library.find((i) => i.id === row.ingredientId);
    return [row.name, ...(item ? [item.name, ...item.aliases] : [])].map(ingredientKey);
  });
  return ingredients.every((term) => names.some((name) => name.includes(ingredientKey(term))));
}

export function recipeIngredientSearch(
  recipe: import('./kitchen').Recipe,
  library: IngredientDefinition[],
  query: string
) {
  const key = ingredientKey(query);
  return (
    !key || ingredientKey(recipe.name).includes(key) || recipeHasIngredients(recipe, library, [key])
  );
}
