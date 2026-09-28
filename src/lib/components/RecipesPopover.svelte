<script lang="ts">
  import type { Recipe, RecipeIngredient } from '$lib/kitchen';
  import { MAX_ACTIVITY_MINUTES } from '$lib/domain';
  import Popover from './Popover.svelte';
  import IngredientListEditor from './IngredientListEditor.svelte';
  import Icon from './Icon.svelte';

  let {
    recipes,
    selectedId = $bindable<string | null>(null),
    newName = $bindable(''),
    anchor,
    oncreate,
    onpatch,
    onadd,
    oningredient,
    onremoveingredient,
    ondelete,
    onclose
  }: {
    recipes: Recipe[];
    selectedId?: string | null;
    newName?: string;
    anchor?: HTMLElement | null;
    oncreate: (name: string) => string | null;
    onpatch: (id: string, patch: Partial<Recipe>) => boolean;
    onadd: (id: string, text: string) => boolean;
    oningredient: (recipeId: string, id: string, patch: Partial<RecipeIngredient>) => boolean;
    onremoveingredient: (recipeId: string, id: string) => void;
    ondelete: (id: string) => boolean;
    onclose: () => void;
  } = $props();
  const selected = $derived(recipes.find((item) => item.id === selectedId));
  function changeNumber(input: HTMLInputElement, old: number, change: (value: number) => boolean) {
    if (
      !input.checkValidity() ||
      !Number.isFinite(input.valueAsNumber) ||
      !change(input.valueAsNumber)
    )
      input.value = String(old);
  }
</script>

<Popover
  {anchor}
  label="Recipes"
  identity={selected?.name}
  {onclose}
  backLabel="All recipes"
  onback={selected ? () => (selectedId = null) : undefined}
>
  {#snippet header()}
    {#if selected}
      <p class="popover-eyebrow">Reusable recipe</p>
      <input
        class="edit-title"
        aria-label="Recipe name"
        data-autofocus
        value={selected.name}
        onchange={(event) => {
          if (!onpatch(selected.id, { name: event.currentTarget.value.trim() }))
            event.currentTarget.value = selected.name;
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    {:else}<p class="popover-eyebrow">Your kitchen</p>
      <h2
        class="recipe-library-title"
        tabindex="-1"
        data-autofocus={recipes.length ? true : undefined}
      >
        Recipes
      </h2>{/if}
  {/snippet}
  {#if selected}
    <div class="recipe-fields">
      <label
        >Makes<input
          aria-label="Recipe yield"
          type="number"
          min="0.001"
          step="any"
          required
          value={selected.yieldQuantity}
          onchange={(event) =>
            changeNumber(event.currentTarget, selected.yieldQuantity, (yieldQuantity) =>
              onpatch(selected.id, { yieldQuantity })
            )}
        /></label
      >
      <label
        >Duration (minutes)<input
          aria-label="Recipe duration minutes"
          type="number"
          min="0"
          max={MAX_ACTIVITY_MINUTES}
          step="1"
          required
          value={selected.durationMinutes}
          onchange={(event) =>
            changeNumber(event.currentTarget, selected.durationMinutes, (durationMinutes) =>
              onpatch(selected.id, { durationMinutes })
            )}
        /></label
      >
    </div>
    <section class="compact-section">
      <h3>Ingredients needed</h3>
      <p class="quiet small">
        A planning checklist, not pantry stock. Add raw food separately when you want to track what
        is used.
      </p>
      <IngredientListEditor
        rows={selected.ingredients}
        context="Recipe"
        draftKey={`recipe:${selected.id}`}
        onadd={(text) => onadd(selected.id, text)}
        onpatch={(id, patch) => oningredient(selected.id, id, patch)}
        onremove={(id) => onremoveingredient(selected.id, id)}
      />
    </section>
    <label class="field"
      >Instructions<textarea
        aria-label="Recipe instructions"
        maxlength="10000"
        value={selected.instructions}
        onchange={(event) => {
          if (!onpatch(selected.id, { instructions: event.currentTarget.value }))
            event.currentTarget.value = selected.instructions;
        }}></textarea></label
    >
    <div class="popover-footer">
      <span>Changes apply immediately</span><button
        class="text-button danger"
        onclick={() => {
          if (ondelete(selected.id)) selectedId = null;
        }}><Icon name="trash" size={13} /> Delete recipe</button
      >
    </div>
  {:else}
    <p class="quiet small">
      Keep reusable recipes here. Add one to your plan from a calendar time.
    </p>
    {#if recipes.length}
      <ul class="recipe-library-list">
        {#each recipes as recipe (recipe.id)}
          <li>
            <button onclick={() => (selectedId = recipe.id)}
              ><span>{recipe.name}</span><small
                >Makes {recipe.yieldQuantity} / {recipe.durationMinutes} minutes</small
              ></button
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p class="quiet recipe-empty">No recipes yet.</p>
    {/if}
    <form
      class="recipe-create"
      onsubmit={(event) => {
        event.preventDefault();
        const id = newName.trim() && oncreate(newName.trim());
        if (id) {
          newName = '';
          selectedId = id;
        }
      }}
    >
      <label class="field"
        >New recipe name<input
          aria-label="New recipe name"
          maxlength="100"
          required
          bind:value={newName}
          data-autofocus={recipes.length ? undefined : true}
        /></label
      >
      <button class="primary-button" type="submit"><Icon name="plus" size={13} /> Add recipe</button
      >
    </form>
  {/if}
</Popover>
