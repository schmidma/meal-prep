<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { confirmAction } from '$lib/confirmation';
  import { onMount } from 'svelte';
  import type { KitchenPlan } from '$lib/kitchen';
  import {
    ingredientInUse,
    removeIngredient,
    updateIngredient,
    mergeIngredients,
    ensureIngredient,
    ingredientKey
  } from '$lib/ingredient-library';
  import Icon from './Icon.svelte';
  let {
    plan,
    onSave,
    onClose
  }: {
    plan: KitchenPlan;
    onSave: (plan: KitchenPlan, message: string) => boolean;
    onClose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let search = $state('');
  let selected = $state('');
  let name = $state('');
  let aliases = $state('');
  let target = $state('');
  let error = $state('');
  let original = $state('');
  const library = $derived(plan.weekly?.ingredientLibrary ?? []);
  const items = $derived(
    library
      .filter((i) =>
        [i.name, ...i.aliases].some((n) => ingredientKey(n).includes(ingredientKey(search)))
      )
      .toSorted((a, b) => a.name.localeCompare(b.name))
  );
  async function canLeave() {
    return (
      !selected ||
      original === JSON.stringify([name, aliases]) ||
      (await confirmAction(i18n.t('ingredient-library.discardTheseIngredientEdits')))
    );
  }
  async function close() {
    if (await canLeave()) onClose();
  }
  async function edit(id: string) {
    if (!(await canLeave())) return;
    const item = library.find((i) => i.id === id)!;
    selected = id;
    name = item.name;
    aliases = item.aliases.join('\n');
    original = JSON.stringify([name, aliases]);
    error = '';
    target = '';
  }
  function save() {
    try {
      const next = updateIngredient(plan, {
        id: selected,
        name: name.trim(),
        aliases: aliases
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      });
      if (onSave(next, i18n.t('ingredient-library.ingredientUpdated'))) {
        selected = '';
        search = '';
      }
    } catch (e) {
      error = i18n.error((e as Error).message);
    }
  }
  onMount(() => {
    dialog.showModal();
    return () => dialog?.close();
  });
</script>

<dialog
  class="wp-dialog wp-library-dialog"
  bind:this={dialog}
  aria-labelledby="ingredient-library-title"
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
  onclick={(e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        close();
    }
  }}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      if (selected) save();
    }}
  >
    <header>
      <!-- svelte-ignore a11y_autofocus -->
      <h2 id="ingredient-library-title" tabindex="-1" autofocus>
        {i18n.t('ingredient-library.ingredients')}
      </h2>
    </header>
    {#if selected}
      <label class="wp-field"
        >{i18n.t('ingredient-library.preferredName')}<input
          bind:value={name}
          required
          maxlength="200"
        /></label
      >
      <label class="wp-field"
        >{i18n.t('ingredient-library.otherNames')}<textarea
          bind:value={aliases}
          rows="4"
          placeholder={i18n.t('ingredient-library.oneAliasPerLine')}></textarea></label
      >
      <p class="wp-modal-help">
        {i18n.t('ingredient-library.namesUpdateInRecipesAndUseSoon')}
      </p>
      <details class="wp-meal-details">
        <summary>{i18n.t('ingredient-library.mergeDuplicateIngredient')}</summary>
        <label class="wp-field"
          >{i18n.t('ingredient-library.keepIngredient')}<select bind:value={target}
            ><option value="">{i18n.t('ingredient-library.chooseAnIngredient')}</option
            >{#each library.filter((i) => i.id !== selected) as item}<option value={item.id}
                >{item.name}</option
              >{/each}</select
          ></label
        >
        <p class="wp-modal-help">
          {i18n.t('ingredient-library.recipeLinksAndAliasesMoveToThe')}
        </p>
        <button
          type="button"
          class="wp-secondary"
          disabled={!target}
          onclick={async () => {
            if (!(await canLeave())) return;
            try {
              if (
                onSave(
                  mergeIngredients(plan, selected, target),
                  i18n.t('ingredient-library.ingredientsMerged')
                )
              )
                selected = '';
            } catch (e) {
              error = i18n.error((e as Error).message);
            }
          }}>{i18n.t('ingredient-library.mergeIngredients')}</button
        >
      </details>
      {#if error}<p role="alert" class="wp-alert">{error}</p>{/if}
      {#if ingredientInUse(plan, selected)}
        <p class="wp-modal-help">{i18n.t('ingredient-library.removeInUse')}</p>
      {/if}
      <footer>
        <button
          type="button"
          class="wp-secondary wp-danger"
          disabled={ingredientInUse(plan, selected)}
          onclick={async () => {
            if (
              !(await confirmAction(
                i18n.t('ingredient-library.removePrompt', {
                  name: library.find((item) => item.id === selected)?.name ?? name
                }),
                i18n.t('ingredient-library.remove'),
                i18n.t('ingredient-library.removeTitle')
              ))
            )
              return;
            if (ingredientInUse(plan, selected)) {
              error = i18n.t('ingredient-library.removeInUse');
              return;
            }
            if (onSave(removeIngredient(plan, selected), i18n.t('planner.ingredientRemoved'))) {
              selected = '';
              error = '';
            }
          }}><Icon name="trash" size={16} />{i18n.t('ingredient-library.remove')}</button
        >
        <div>
          <button
            type="button"
            class="wp-secondary"
            onclick={async () => {
              if (await canLeave()) selected = '';
            }}>{i18n.t('planner.cancel')}</button
          ><button class="wp-primary">{i18n.t('planner.save')}</button>
        </div>
      </footer>
    {:else}
      <input
        class="wp-search"
        type="search"
        aria-label={i18n.t('ingredient-library.searchIngredients')}
        placeholder={i18n.t('ingredient-library.searchNamesOrAliases')}
        bind:value={search}
      />
      <div class="wp-library-list">
        {#each items as item}<button type="button" onclick={() => edit(item.id)}
            ><span
              ><strong>{item.name}</strong>{#if item.aliases.length}<small
                  >{item.aliases.join(' · ')}</small
                >{/if}</span
            ><Icon name="edit" size={16} /></button
          >{/each}
      </div>
      {#if !items.length}<p>{i18n.t('ingredient-library.noMatchingIngredients')}</p>{/if}
      {#if search.trim() && !library.some( (i) => [i.name, ...i.aliases].some((n) => ingredientKey(n) === ingredientKey(search)) )}<button
          type="button"
          class="wp-secondary"
          onclick={async () => {
            const next = structuredClone(plan);
            const item = ensureIngredient(next.weekly!.ingredientLibrary!, search);
            if (onSave(next, i18n.t('planner.ingredientAdded'))) {
              search = '';
              selected = item.id;
              name = item.name;
              aliases = '';
              original = JSON.stringify([name, aliases]);
              error = '';
              target = '';
            }
          }}>{i18n.t('ingredients.addNamed', { name: search.trim() })}</button
        >{/if}
      <footer>
        <button type="button" class="wp-secondary" onclick={close}
          >{i18n.t('ingredient-library.done')}</button
        >
      </footer>
    {/if}
  </form>
</dialog>
