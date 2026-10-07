<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { recipeIngredientSearch, type IngredientDefinition } from '$lib/ingredient-library';
  import { recipeMatches, type UseSoonItem } from '$lib/use-soon';
  import type { Recipe } from '$lib/kitchen';
  import { photoUrl } from '$lib/food-photos';
  let {
    value,
    recipes,
    images = {},
    bookNames = {},
    label = i18n.t('planner.mealName'),
    hideLabel = false,
    useSoon = [],
    library = [],
    onInput,
    onSelect
  }: {
    value: string;
    recipes: Recipe[];
    images?: Record<string, string>;
    bookNames?: Record<string, string>;
    label?: string;
    hideLabel?: boolean;
    useSoon?: UseSoonItem[];
    library?: IngredientDefinition[];
    onInput: (value: string) => void;
    onSelect: (recipe: Recipe) => void;
  } = $props();
  const id = $props.id();
  let focused = $state(false);
  let dismissed = $state('\0');
  let active = $state(-1);
  const matches = $derived(
    recipes
      .filter((r) => recipeIngredientSearch(r, library, value))
      .toSorted((a, b) => recipeMatches(b, useSoon).length - recipeMatches(a, useSoon).length)
  );
  const open = $derived(focused && value !== dismissed && matches.length > 0);
  function choose(recipe: Recipe) {
    dismissed = recipe.name;
    focused = false;
    active = -1;
    onSelect(recipe);
  }
</script>

<div class="wp-recipe-input">
  {#if !hideLabel}<label class="wp-field" for={id}>{label}</label>{/if}
  <input
    {id}
    aria-label={label}
    {value}
    required
    maxlength="200"
    autocomplete="off"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={`${id}-suggestions`}
    aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
    placeholder={i18n.t('recipe-input.typeADishOrRecipeName')}
    onfocus={() => (focused = true)}
    onclick={() => {
      focused = true;
      dismissed = '\0';
    }}
    onblur={() => (focused = false)}
    oninput={(e) => {
      focused = true;
      dismissed = '\0';
      active = -1;
      onInput(e.currentTarget.value);
    }}
    onkeydown={(e) => {
      if (!open && ['ArrowDown', 'ArrowUp'].includes(e.key) && matches.length) {
        e.preventDefault();
        focused = true;
        dismissed = '\0';
        active = e.key === 'ArrowDown' ? 0 : matches.length - 1;
      } else if (open && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        active =
          (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1) + matches.length) %
          matches.length;
      } else if (open && e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        choose(matches[active]);
      } else if (open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        focused = false;
      }
    }}
  />
  {#if open}<div
      class="wp-recipe-options"
      id={`${id}-suggestions`}
      role="listbox"
      aria-label={i18n.t('recipe-input.matchingRecipes')}
    >
      {#each matches as recipe, i}<button
          type="button"
          role="option"
          id={`${id}-option-${i}`}
          aria-selected={active === i}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => choose(recipe)}
        >
          {#if photoUrl(images[recipe.id], 320)}<img
              src={photoUrl(images[recipe.id], 320)}
              alt=""
            />{/if}
          <span
            >{recipe.name}{#if bookNames[recipe.id]}<small>{bookNames[recipe.id]}</small>{/if}<small
              >{recipeMatches(recipe, useSoon).length
                ? i18n.t('recipes.uses', {
                    ingredients: recipeMatches(recipe, useSoon)
                      .map((item) => item.name)
                      .join(', ')
                  })
                : i18n.t('recipes.portions', { count: recipe.yieldQuantity })}</small
            ></span
          >
        </button>{/each}
    </div>{/if}
</div>
