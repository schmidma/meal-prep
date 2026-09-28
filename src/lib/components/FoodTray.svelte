<script lang="ts">
  import { batchTotals } from '$lib/domain';
  import { ingredientTotals, type KitchenPlan } from '$lib/kitchen';
  import { displayBalance, quantity } from '$lib/view';
  import Icon from './Icon.svelte';
  let {
    plan,
    selectedId,
    related,
    onhover,
    onleave,
    onkeyboard,
    onadd,
    onselect,
    ondrag
  }: {
    plan: KitchenPlan;
    selectedId: string | null;
    related: Set<string>;
    onhover: (id: string | null, event: PointerEvent) => void;
    onleave: (id: string, event: PointerEvent) => void;
    onkeyboard: (id: string | null) => void;
    onadd: (kind: 'ingredient' | 'batch', text: string) => boolean;
    onselect: (kind: 'ingredient' | 'batch', id: string, anchor: HTMLElement) => void;
    ondrag: (event: PointerEvent, kind: 'ingredient' | 'batch', id: string) => void;
  } = $props();
  let ingredientText = $state('');
  let preparedText = $state('');
  const existing = $derived(plan.batches.filter((batch) => batch.source.kind === 'existing'));
  function focusAdd(event: MouseEvent) {
    (event.currentTarget as HTMLElement).closest('section')?.querySelector('input')?.focus();
  }
</script>

<aside class="home-tray" aria-label="At home">
  <h2 class="tray-heading"><Icon name="home" size={18} /> At home</h2>
  <div class="tray-content">
    <p class="tray-intro">A few things to give a place in your plan.</p>
    <section aria-label="Ingredients to use">
      <div class="tray-section-title">
        <span class="status-dot"></span>
        <h2>Ingredients to use</h2>
        <button class="stock-add-shortcut" aria-label="Enter a new ingredient" onclick={focusAdd}
          ><Icon name="plus" size={16} /></button
        >
      </div>
      <div class="stock-row">
        {#each plan.ingredients as ingredient (ingredient.id)}
          {@const remaining = displayBalance(
            ingredient.quantity,
            ingredientTotals(plan, ingredient.id).assigned
          )}
          <button
            class="food-chip ingredient-chip"
            class:selected={selectedId === ingredient.id}
            class:related={related.has(ingredient.id) && selectedId !== ingredient.id}
            class:accounted={remaining === 0}
            class:over-assigned={remaining < 0}
            onclick={(event) => onselect('ingredient', ingredient.id, event.currentTarget)}
            onpointerdown={(event) => ondrag(event, 'ingredient', ingredient.id)}
            onpointermove={(event) => onhover(ingredient.id, event)}
            onpointerleave={(event) => onleave(ingredient.id, event)}
            onfocus={(event) => {
              if (event.currentTarget.matches(':focus-visible')) onkeyboard(ingredient.id);
            }}
            onblur={() => onkeyboard(null)}
            data-food-id={ingredient.id}
            data-testid={`food-${ingredient.id}`}
          >
            <span class="drag-grip" data-drag-handle title="Drag onto an activity"
              ><Icon name="grip" size={15} /></span
            >
            <span class="food-copy"
              ><strong
                >{quantity(ingredient.quantity)}
                {ingredient.name}</strong
              ><small
                >{remaining === 0
                  ? 'All planned'
                  : remaining < 0
                    ? `${quantity(-remaining, ingredient.quantity)} over-assigned`
                    : `${quantity(remaining, ingredient.quantity)} still unplanned`}</small
              ></span
            >
            {#if remaining < 0}<Icon name="alert" size={15} />{:else if remaining === 0}<Icon
                name="check"
                size={15}
              />{:else}<Icon name="leaf" size={15} />{/if}
          </button>
        {/each}
        <form
          class="food-add"
          onsubmit={(event) => {
            event.preventDefault();
            if (onadd('ingredient', ingredientText)) ingredientText = '';
          }}
        >
          <input
            aria-label="Add ingredient"
            placeholder="e.g. 2 paprika"
            bind:value={ingredientText}
            required
            autocomplete="off"
          />
          <button
            aria-label="Add ingredient to use"
            title="Add ingredient"
            disabled={!ingredientText.trim()}><Icon name="plus" size={16} /></button
          >
        </form>
      </div>
      <p class="tray-help">
        Drag onto a cooking or eating card.<br />Tap a chip to split its quantity.
      </p>
    </section>
    <section class="prepared-section" aria-label="Already cooked food">
      <div class="tray-section-title">
        <span class="status-dot warm"></span>
        <h2>Already cooked</h2>
        <button class="stock-add-shortcut" aria-label="Enter new cooked food" onclick={focusAdd}
          ><Icon name="plus" size={16} /></button
        >
      </div>
      <div class="stock-row">
        {#each existing as batch (batch.id)}
          {@const remaining = displayBalance(batch.quantity, batchTotals(plan, batch.id).assigned)}
          <button
            class="food-chip prepared-chip"
            class:over-assigned={remaining < 0}
            class:selected={selectedId === batch.id}
            class:related={related.has(batch.id) && selectedId !== batch.id}
            onclick={(event) => onselect('batch', batch.id, event.currentTarget)}
            onpointerdown={(event) => ondrag(event, 'batch', batch.id)}
            onpointermove={(event) => onhover(batch.id, event)}
            onpointerleave={(event) => onleave(batch.id, event)}
            onfocus={(event) => {
              if (event.currentTarget.matches(':focus-visible')) onkeyboard(batch.id);
            }}
            onblur={() => onkeyboard(null)}
            data-food-id={batch.id}
            data-testid={`food-${batch.id}`}
          >
            <span class="drag-grip" data-drag-handle title="Drag onto a meal"
              ><Icon name="grip" size={15} /></span
            >
            <span class="food-copy"
              ><strong>{batch.name}</strong><small
                >{remaining < 0
                  ? `${quantity(-remaining, batch.quantity)} over-assigned`
                  : `${quantity(remaining, batch.quantity)} unplanned`}</small
              ></span
            ><Icon name={remaining < 0 ? 'alert' : 'bowl'} size={15} />
          </button>
        {/each}
        <form
          class="food-add"
          onsubmit={(event) => {
            event.preventDefault();
            if (onadd('batch', preparedText)) preparedText = '';
          }}
        >
          <input
            aria-label="Add cooked food"
            placeholder="e.g. 2 curry"
            bind:value={preparedText}
            required
            autocomplete="off"
          />
          <button
            aria-label="Add already cooked food"
            title="Add cooked food"
            disabled={!preparedText.trim()}><Icon name="plus" size={16} /></button
          >
        </form>
      </div>
      <p class="tray-help">Ready to eat. No cooking session needed.</p>
    </section>
    <div class="tray-footnote">
      <Icon name="info" size={14} /><span
        >These are planning amounts, not a live pantry inventory.</span
      >
    </div>
  </div>
</aside>
