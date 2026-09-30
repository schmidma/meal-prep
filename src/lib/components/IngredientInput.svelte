<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import type { IngredientDefinition } from '$lib/ingredient-library';
  import {
    suggestIngredients,
    ingredientLine,
    parseRecipeIngredientLine
  } from '$lib/ingredient-library';
  let {
    value,
    library,
    label = i18n.t('ingredient-input.ingredient'),
    descriptionId,
    newIngredientHint = i18n.t('ingredient-input.pressEnterToAddThisIngredient'),
    onInput,
    onSelect,
    required = false,
    amounts = false,
    onEnter,
    placeholder = i18n.t('ingredient-input.typeAnIngredient')
  }: {
    value: string;
    library: IngredientDefinition[];
    label?: string;
    descriptionId?: string;
    newIngredientHint?: string;
    required?: boolean;
    amounts?: boolean;
    onEnter?: () => void;
    placeholder?: string;
    onInput: (value: string) => void;
    onSelect?: (item: IngredientDefinition) => void;
  } = $props();
  const id = $props.id();
  let focused = $state(false);
  let active = $state(-1);
  const query = $derived(amounts ? parseRecipeIngredientLine(value).name : value);
  const matches = $derived(suggestIngredients(library, query));
  const open = $derived(focused && !!value.trim() && matches.length > 0);
  function choose(item: IngredientDefinition) {
    onInput(
      amounts ? ingredientLine({ ...parseRecipeIngredientLine(value), name: item.name }) : item.name
    );
    onSelect?.(item);
    focused = false;
    active = -1;
  }
</script>

<div class="wp-ingredient-input">
  <input
    {id}
    aria-label={label}
    aria-describedby={descriptionId}
    {value}
    {required}
    maxlength="200"
    {placeholder}
    autocomplete="off"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={`${id}-options`}
    aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
    oninput={(e) => {
      onInput(e.currentTarget.value);
      focused = true;
      active = -1;
    }}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    onkeydown={(e) => {
      if (e.isComposing) return;
      if (open && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        active =
          (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1) + matches.length) %
          matches.length;
      } else if (open && e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        choose(matches[active]);
      } else if (e.key === 'Enter' && onEnter) {
        e.preventDefault();
        onEnter();
      } else if (open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        focused = false;
      }
    }}
  />
  {#if open}<div
      id={`${id}-options`}
      role="listbox"
      aria-label={i18n.t('ingredient-input.matchingIngredients')}
      class="wp-ingredient-options"
    >
      {#each matches as item, index}<button
          type="button"
          role="option"
          id={`${id}-${index}`}
          aria-selected={active === index}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => choose(item)}
        >
          <strong>{item.name}</strong>{#if item.aliases.length}<small
              >{item.aliases.join(' · ')}</small
            >{/if}
        </button>{/each}
    </div>{/if}
  {#if newIngredientHint && focused && value.trim() && !amounts && !matches.length}<small
      class="wp-ingredient-new">{newIngredientHint}</small
    >{/if}
</div>
