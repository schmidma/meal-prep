<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { getInspector } from '$lib/inspector';

  let {
    rows,
    context,
    draftKey,
    onpatch,
    onremove,
    onadd,
    rowContext
  }: {
    rows: { id: string; name: string; quantity: number }[];
    context: string;
    draftKey: string;
    onpatch: (id: string, patch: { name?: string; quantity?: number }) => boolean;
    onremove: (id: string) => void;
    onadd: (text: string) => boolean;
    rowContext?: Snippet<[{ id: string; name: string; quantity: number }]>;
  } = $props();
  const inspector = getInspector();
  const entry = $derived(inspector.ingredientDrafts[draftKey] ?? '');
  function add() {
    if (entry.trim() && onadd(entry.trim())) inspector.setIngredientDraft(draftKey, '');
  }
</script>

{#each rows as row, index (row.id)}
  <div class="recipe-ingredient-row">
    <input
      aria-label={`${context} ingredient ${index + 1} name`}
      value={row.name}
      required
      onchange={(event) => {
        if (!onpatch(row.id, { name: event.currentTarget.value.trim() }))
          event.currentTarget.value = row.name;
      }}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
    <input
      aria-label={`${context} quantity for ${row.name}`}
      type="number"
      min="0.001"
      step="any"
      required
      value={row.quantity}
      onchange={(event) => {
        const input = event.currentTarget;
        if (!input.checkValidity() || !onpatch(row.id, { quantity: input.valueAsNumber }))
          input.value = String(row.quantity);
      }}
    />
    <button
      class="icon-button tiny"
      aria-label={`Remove ${context} ingredient ${row.name}`}
      onclick={() => onremove(row.id)}><Icon name="close" size={13} /></button
    >
  </div>
  {#if rowContext}{@render rowContext(row)}{/if}
{/each}
<form
  class="recipe-add-row"
  onsubmit={(event) => {
    event.preventDefault();
    add();
  }}
>
  <input
    aria-label={`Add ${context} ingredient`}
    placeholder="2 carrots or carrots"
    value={entry}
    oninput={(event) => inspector.setIngredientDraft(draftKey, event.currentTarget.value)}
  />
  <button class="text-button" type="submit" aria-label={`Add ${context} ingredient row`}
    ><Icon name="plus" size={13} /> Add</button
  >
</form>
