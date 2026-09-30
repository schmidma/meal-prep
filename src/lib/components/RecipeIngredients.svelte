<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { newId } from '$lib/id';
  import { tick } from 'svelte';
  import type { RecipeIngredient } from '$lib/kitchen';
  import type { IngredientDefinition } from '$lib/ingredient-library';
  import { parseRecipeIngredientLine, ingredientLine } from '$lib/ingredient-library';
  import IngredientInput from './IngredientInput.svelte';
  import Icon from './Icon.svelte';
  let {
    rows,
    library,
    onChange,
    pasted = $bindable('')
  }: {
    rows: RecipeIngredient[];
    pasted?: string;
    library: IngredientDefinition[];
    onChange: (rows: RecipeIngredient[]) => void;
  } = $props();
  let lines = $state<Record<string, string>>({});
  let container: HTMLElement;
  let pasteOpen = $state(false);
  function update(id: string, value: string) {
    lines[id] = value;
    onChange(rows.map((row) => (row.id === id ? parseRecipeIngredientLine(value, id) : row)));
  }
  async function add() {
    if (!rows.some((row) => !row.name.trim())) {
      const id = newId('recipe-ingredient');
      lines[id] = '';
      onChange([...rows, { id, name: '', quantity: 1, unit: '', preparation: '' }]);
    }
    await tick();
    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    inputs[inputs.length - 1]?.focus();
  }
</script>

<section
  class="wp-recipe-ingredients"
  aria-label={i18n.t('recipe-ingredients.recipeIngredients')}
  bind:this={container}
>
  <div class="wp-panel-heading"><strong>{i18n.t('ingredient-library.ingredients')}</strong></div>
  <p class="wp-recipe-hint">{i18n.t('recipe-ingredients.oneLineEachEg2TinsChickpeas')}</p>
  <div class="wp-recipe-lines">
    {#each rows as row, index (row.id)}
      <div class="wp-recipe-line">
        <IngredientInput
          value={lines[row.id] ??
            (!row.name
              ? ''
              : row.unit === undefined && row.preparation === undefined
                ? row.name
                : ingredientLine(row))}
          {library}
          amounts
          label={i18n.t('recipes.ingredientNumber', { number: index + 1 })}
          placeholder={i18n.t('recipe-ingredients.amountAndIngredient')}
          onInput={(value) => update(row.id, value)}
          onEnter={add}
        />
        <button
          type="button"
          class="wp-icon-button"
          aria-label={i18n.t('recipes.removeIngredientNumber', { number: index + 1 })}
          onclick={() => onChange(rows.filter((i) => i.id !== row.id))}
          ><Icon name="trash" size={16} /></button
        >
      </div>
    {/each}
  </div>
  <button type="button" class="wp-secondary wp-add-ingredient" onclick={add}
    ><Icon name="plus" size={15} />{i18n.t('recipe-ingredients.addIngredient')}</button
  >
  <details class="wp-meal-details" bind:open={pasteOpen}>
    <summary>{i18n.t('recipe-ingredients.pasteIngredientLines')}</summary>
    <label class="wp-field"
      >{i18n.t('ingredient-library.ingredients')}<textarea
        bind:value={pasted}
        rows="4"
        placeholder={i18n.t('recipes.pasteExample')}></textarea></label
    >
    <button
      type="button"
      class="wp-secondary"
      disabled={!pasted.trim()}
      onclick={() => {
        onChange([
          ...rows.filter((row) => row.name.trim()),
          ...pasted
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => parseRecipeIngredientLine(s))
        ]);
        pasted = '';
        pasteOpen = false;
      }}>{i18n.t('recipe-ingredients.addPastedIngredients')}</button
    >
  </details>
</section>
