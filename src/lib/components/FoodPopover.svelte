<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { formatTime, parseTime } from '$lib/calendar';
  import { allocationAt, batchReadyAt, batchTotals, type LocalTime } from '$lib/domain';
  import {
    allocationDescription,
    fullTime,
    type EntityRef,
    type RelationSelection
  } from '$lib/relationships';
  import RelationshipRow from './RelationshipRow.svelte';
  import { ingredientTotals, type KitchenPlan } from '$lib/kitchen';
  import { dateLabel, displayBalance, quantity } from '$lib/view';
  import Popover from './Popover.svelte';
  import Icon from './Icon.svelte';
  let {
    plan,
    kind,
    id,
    reveal,
    anchor,
    lastActivityId,
    onpatch,
    onassign,
    onchoosecalendar,
    onsetuse,
    onallocation,
    onready,
    onplanmeal,
    onnavigate,
    onpreview,
    ondelete,
    onclose
  }: {
    plan: KitchenPlan;
    kind: 'ingredient' | 'batch';
    id: string;
    reveal?: 'availability';
    anchor?: HTMLElement | null;
    lastActivityId: string | null;
    onpatch: (patch: { name?: string; quantity?: number }) => boolean;
    onassign: (activityId: string, amount: number) => boolean;
    onchoosecalendar: (amount: number) => void;
    onsetuse: (useId: string, amount: number) => boolean;
    onallocation: (id: string, amount: number) => boolean;
    onready: (time: LocalTime) => boolean;
    onplanmeal: () => void;
    onnavigate: (target: EntityRef, at?: LocalTime) => void;
    onpreview: (token: object, selection: RelationSelection | null, label: string) => void;
    ondelete: () => void;
    onclose: () => void;
  } = $props();
  const food = $derived(
    (kind === 'ingredient' ? plan.ingredients : plan.batches).find((item) => item.id === id)!
  );
  const totals = $derived(
    kind === 'ingredient' ? ingredientTotals(plan, id) : batchTotals(plan, id)
  );
  const remaining = $derived(displayBalance(food.quantity, totals.assigned));
  const uses = $derived(
    kind === 'ingredient'
      ? plan.ingredientUses.filter((use) => use.ingredientId === id)
      : plan.allocations.filter((use) => use.batchId === id)
  );
  const batch = $derived(
    kind === 'batch' ? plan.batches.find((item) => item.id === id) : undefined
  );
  let targetId = $state(untrack(() => lastActivityId ?? ''));
  let amount = $state(
    untrack(() =>
      Math.max(
        0,
        kind === 'ingredient'
          ? ingredientTotals(plan, id).remaining
          : Math.min(2, batchTotals(plan, id).remaining)
      )
    )
  );
  let availability = $state<HTMLDetailsElement>();
  let availabilityOpen = $state(untrack(() => reveal === 'availability'));
  onMount(() => {
    let mounted = true;
    if (reveal === 'availability')
      void tick().then(() => {
        if (!mounted || !availability?.isConnected) return;
        const body = availability.closest('.inspector-body') as HTMLElement;
        body.scrollTop +=
          availability.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
        availability
          .querySelector<HTMLInputElement>('[aria-label="Food available time"]')
          ?.focus({ preventScroll: true });
      });
    return () => {
      mounted = false;
    };
  });
  function useFood(event: SubmitEvent) {
    event.preventDefault();
    const left = remaining - amount;
    if (targetId && onassign(targetId, amount)) amount = Math.max(0, left);
  }
</script>

<Popover
  {anchor}
  label={kind === 'ingredient' ? 'Ingredient' : 'Prepared food'}
  identity={food.name}
  {onclose}
>
  {#snippet header()}
    <p class="popover-eyebrow">
      {kind === 'ingredient'
        ? 'An ingredient to use'
        : batch?.source.kind === 'activity'
          ? 'Planned food output'
          : 'Food already made'}
    </p>
    <input
      class="edit-title"
      aria-label="Food name"
      value={food.name}
      maxlength="100"
      onchange={(e) => {
        if (!onpatch({ name: e.currentTarget.value.trim() })) e.currentTarget.value = food.name;
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  {/snippet}
  <div class="batch-heading">
    <label
      ><input
        class="quantity-input"
        type="number"
        min="0.001"
        step="any"
        required
        aria-label={batch?.source.kind === 'activity' ? 'Planned quantity' : 'Amount at home'}
        value={food.quantity}
        onchange={(e) => {
          if (
            !e.currentTarget.checkValidity() ||
            !onpatch({ quantity: e.currentTarget.valueAsNumber })
          )
            e.currentTarget.value = String(food.quantity);
        }}
      />
      {batch?.source.kind === 'activity' ? 'planned' : 'at home'}</label
    ><small class:negative={remaining < 0}
      >{remaining < 0
        ? `${quantity(-remaining, food.quantity)} over-assigned`
        : `${quantity(remaining, food.quantity)} still unplanned`}</small
    >
  </div>
  {#if batch?.source.kind === 'activity'}
    {@const producer = plan.activities.find(
      (item) => batch.source.kind === 'activity' && item.id === batch.source.activityId
    )}
    {#if producer}<button
        class="text-button"
        onclick={() => onnavigate({ kind: 'activity', id: producer.id }, batchReadyAt(plan, batch))}
        >From {producer.title} / ready {fullTime(batchReadyAt(plan, batch)!)}</button
      >{/if}
  {/if}
  <form class="use-food-form" onsubmit={useFood}>
    <label class="sr-only" for="use-destination">Use in activity</label><select
      id="use-destination"
      bind:value={targetId}
      required
      ><option value="">Choose an activity...</option
      >{#each [...plan.activities].sort((a, b) => a.start.day.localeCompare(b.start.day) || a.start.minute - b.start.minute) as activity}<option
          value={activity.id}
          >{dateLabel(activity.start.day, { weekday: 'short', day: 'numeric' })}
          {formatTime(activity.start.minute)} / {activity.title}</option
        >{/each}</select
    >
    <div class="use-food-amount">
      <label
        >Use <input
          aria-label="Amount to assign"
          type="number"
          min="0.001"
          step="any"
          bind:value={amount}
          required
        />
      </label><button class="primary-button" type="submit" disabled={!targetId || amount <= 0}
        >Use here <Icon name="arrow" size={14} /></button
      >
    </div>
    <button
      class="secondary-button"
      type="button"
      disabled={!Number.isFinite(amount) || amount <= 0}
      onclick={() => onchoosecalendar(amount)}>Choose on calendar</button
    >
  </form>
  {#if kind === 'batch'}<button class="plan-meal-button" onclick={onplanmeal}
      ><Icon name="plus" size={14} /> Plan a new meal from this</button
    >{/if}
  {#if uses.length}
    <section class="compact-section">
      <h3>Where it's going</h3>
      {#each uses as use, index (use.id)}
        {@const activity = plan.activities.find((a) => a.id === use.activityId)}
        {@const assignmentLabel = `${activity?.title ?? 'Missing activity'}, ${
          'batchId' in use
            ? allocationDescription(plan, use)
            : activity
              ? fullTime(activity.start)
              : 'time unavailable'
        }, assignment ${index + 1}`}
        <RelationshipRow
          selection={{
            allocationIds: kind === 'batch' ? [use.id] : [],
            ingredientUseIds: kind === 'ingredient' ? [use.id] : []
          }}
          label={`${quantity(use.quantity)} ${food.name} to ${assignmentLabel}`}
          {onpreview}
        >
          <button
            class="allocation-destination"
            onclick={() =>
              activity &&
              onnavigate(
                { kind: 'activity', id: activity.id },
                'batchId' in use ? allocationAt(plan, use) : activity.start
              )}
            >{activity?.title ?? 'Missing activity'}<small
              >{'batchId' in use
                ? allocationDescription(plan, use)
                : activity
                  ? fullTime(activity.start)
                  : ''}</small
            ></button
          ><input
            type="number"
            min="0"
            step="any"
            required
            aria-label={`Amount assigned to ${assignmentLabel}`}
            value={use.quantity}
            onchange={(e) => {
              if (
                !e.currentTarget.checkValidity() ||
                !(kind === 'batch'
                  ? onallocation(use.id, e.currentTarget.valueAsNumber)
                  : onsetuse(use.id, e.currentTarget.valueAsNumber))
              )
                e.currentTarget.value = String(use.quantity);
            }}
          /><button
            class="icon-button tiny"
            aria-label={`Unassign from ${assignmentLabel}`}
            onclick={() => (kind === 'batch' ? onallocation(use.id, 0) : onsetuse(use.id, 0))}
            ><Icon name="close" size={12} /></button
          >
        </RelationshipRow>
      {/each}
    </section>
  {/if}
  {#if remaining < 0}<p class="inline-warning">
      <Icon name="alert" size={14} /> More assigned than you have. Adjust an amount, or leave it flagged
      while you plan.
    </p>{/if}
  {#if batch?.source.kind === 'existing'}
    {@const ready = batch.source.availableAt}
    <details class="extra-details" bind:this={availability} bind:open={availabilityOpen}>
      <summary>More details</summary>
      <p class="quiet small">Available from</p>
      <div class="inline-fields">
        <input
          aria-label="Food available date"
          type="date"
          min="0001-01-01"
          max="9998-12-31"
          required
          value={ready.day}
          onchange={(e) => {
            if (
              !e.currentTarget.checkValidity() ||
              !onready({ ...ready, day: e.currentTarget.value })
            )
              e.currentTarget.value = ready.day;
          }}
        /><input
          aria-label="Food available time"
          type="time"
          required
          value={formatTime(ready.minute)}
          onchange={(e) => {
            if (
              !e.currentTarget.value ||
              !onready({ ...ready, minute: parseTime(e.currentTarget.value) })
            )
              e.currentTarget.value = formatTime(ready.minute);
          }}
        />
      </div>
    </details>
  {/if}
  <div class="popover-footer">
    <span>Planning does not mark food eaten</span><button
      class="text-button danger"
      onclick={ondelete}><Icon name="trash" size={13} /> Remove</button
    >
  </div>
</Popover>
