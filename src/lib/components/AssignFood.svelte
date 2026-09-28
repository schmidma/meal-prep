<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { KitchenPlan } from '$lib/kitchen';
  import { foodChoices, foodNameKey, suggestedAmount } from '$lib/food-choices';
  import { quantity } from '$lib/view';
  let {
    plan,
    activityId,
    initialSearch = '',
    need,
    onassign,
    onclose
  }: {
    plan: KitchenPlan;
    activityId: string;
    initialSearch?: string;
    need?: number;
    onassign: (kind: 'ingredient' | 'batch', id: string, amount: number) => boolean;
    onclose: () => void;
  } = $props();
  let search = $state(untrack(() => initialSearch));
  let previousSearch = untrack(() => initialSearch);
  $effect(() => {
    if (initialSearch !== previousSearch) {
      search = initialSearch;
      previousSearch = initialSearch;
    }
  });
  let selected = $state<string | null>(null);
  let amount = $state(0);
  let confirmation = $state('');
  let region: HTMLDivElement;
  let searchInput: HTMLInputElement;
  onMount(() => {
    void tick().then(() => {
      if (!region.isConnected) return;
      const body = region.closest<HTMLElement>('.inspector-body');
      if (body)
        body.scrollTop += region.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
      searchInput.focus({ preventScroll: true });
    });
  });
  const choices = $derived(foodChoices(plan, activityId));
  const filtered = $derived(
    choices.filter((item) => foodNameKey(item.name).includes(foodNameKey(search)))
  );
  const chosen = $derived(choices.find((item) => `${item.kind}:${item.id}` === selected));
</script>

<div class="assign-food" bind:this={region} role="region" aria-label="Assign food to this activity">
  <div class="assign-heading">
    <strong>Assign food</strong><button class="text-button" onclick={onclose}>Done</button>
  </div>
  <input
    bind:this={searchInput}
    type="search"
    aria-label="Search food to assign"
    placeholder="Search ingredients or prepared food"
    bind:value={search}
  />
  <p class="quiet small">Choose a source, then an amount. Planned batches are included.</p>
  <div class="food-choices">
    {#each filtered as item (`${item.kind}:${item.id}`)}
      <button
        class="food-choice"
        class:active={selected === `${item.kind}:${item.id}`}
        aria-pressed={selected === `${item.kind}:${item.id}`}
        onclick={() => {
          selected = `${item.kind}:${item.id}`;
          amount = suggestedAmount(
            item.remaining,
            foodNameKey(item.name) === foodNameKey(initialSearch) ? need : undefined
          );
          confirmation = '';
        }}
      >
        <strong>{item.name}</strong><span>{quantity(item.remaining)} remaining</span><small
          >{item.source}</small
        >
      </button>
    {:else}<p class="quiet small">
        No matching food. Try another name or add stock at home.
      </p>{/each}
  </div>
  {#if chosen}
    <form
      class="assign-commit"
      onsubmit={(event) => {
        event.preventDefault();
        if (Number.isFinite(amount) && amount > 0 && onassign(chosen.kind, chosen.id, amount)) {
          confirmation = `Assigned ${quantity(amount)} ${chosen.name} here.`;
          selected = null;
          void tick().then(() => {
            if (searchInput?.isConnected) searchInput.focus({ preventScroll: true });
          });
        }
      }}
    >
      <label
        >Amount of {chosen.name}<input
          aria-label={`Quantity to assign of ${chosen.name}`}
          type="number"
          min="0.001"
          step="any"
          required
          bind:value={amount}
        /></label
      >
      <button
        class="primary-button"
        type="submit"
        disabled={!Number.isFinite(amount) || amount <= 0}>Assign here</button
      >
    </form>
    {#if amount > chosen.remaining}<p class="quiet small">
        This exceeds the remaining amount. You can still assign it and review the warning.
      </p>{/if}
  {/if}
  {#if confirmation}<p class="assignment-confirmation" role="status">{confirmation}</p>{/if}
</div>
