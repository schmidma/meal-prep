<script lang="ts">
  import { tick, onMount, untrack } from 'svelte';
  import { formatTime, parseTime } from '$lib/calendar';
  import {
    MAX_ACTIVITY_MINUTES,
    batchTotals,
    batchReadyAt,
    allocationAt,
    type LocalTime,
    type Activity,
    type Batch,
    type Warning
  } from '$lib/domain';
  import type { KitchenPlan, ActivityRequirement } from '$lib/kitchen';
  import { dateLabel, displayBalance, quantity, warningsFor } from '$lib/view';
  import { endLabel } from '$lib/time-layout';
  import {
    allocationDescription,
    fullTime,
    warningTargets,
    type EntityRef,
    type RelationSelection
  } from '$lib/relationships';
  import RelationshipRow from './RelationshipRow.svelte';
  import Popover from './Popover.svelte';
  import Icon from './Icon.svelte';
  import IngredientListEditor from './IngredientListEditor.svelte';
  import AssignFood from './AssignFood.svelte';
  import { allocatedHere } from '$lib/food-choices';
  import { planChecks, warningKey } from '$lib/plan-checks';
  let {
    plan,
    activity,
    warnings,
    reveal,
    anchor,
    onpatch,
    onbatch,
    onallocation,
    oningredient,
    onassign,
    requirements,
    onrequirement,
    onaddrequirement,
    onremoverequirement,
    onplanmeal,
    oneathere,
    onaddbatch,
    onremovebatch,
    onnavigate,
    onpreview,
    ondelete,
    onclose
  }: {
    plan: KitchenPlan;
    activity: Activity;
    warnings: Warning[];
    reveal?: 'schedule';
    anchor?: HTMLElement | null;
    onpatch: (patch: Partial<Activity>) => boolean;
    onbatch: (id: string, patch: Partial<Batch>) => boolean;
    onallocation: (id: string, amount: number) => boolean;
    oningredient: (id: string, amount: number) => boolean;
    onassign: (kind: 'ingredient' | 'batch', foodId: string, amount: number) => boolean;
    requirements: ActivityRequirement[];
    onrequirement: (id: string, patch: Partial<ActivityRequirement>) => boolean;
    onaddrequirement: (text: string) => boolean;
    onremoverequirement: (id: string) => void;
    onplanmeal: (id: string) => void;
    oneathere: (id: string) => void;
    onaddbatch: () => void;
    onremovebatch: (id: string) => void;
    onnavigate: (target: EntityRef, at?: LocalTime) => void;
    onpreview: (token: object, selection: RelationSelection | null, label: string) => void;
    ondelete: () => void;
    onclose: () => void;
  } = $props();
  let schedule: HTMLDetailsElement;
  let scheduleOpen = $state(untrack(() => reveal === 'schedule'));
  onMount(() => {
    let mounted = true;
    if (reveal === 'schedule')
      void tick().then(() => {
        if (!mounted || !schedule?.isConnected) return;
        schedule
          .querySelector<HTMLInputElement>('[aria-label="Activity time"]')
          ?.focus({ preventScroll: true });
      });
    return () => {
      mounted = false;
    };
  });
  const outputs = $derived(
    plan.batches.filter(
      (batch) => batch.source.kind === 'activity' && batch.source.activityId === activity.id
    )
  );
  const uses = $derived(plan.ingredientUses.filter((use) => use.activityId === activity.id));
  const inputs = $derived(
    plan.allocations.filter(
      (use) => use.activityId === activity.id && !outputs.some((batch) => batch.id === use.batchId)
    )
  );
  const issues = $derived(warningsFor(plan, warnings, activity.id));
  const notices = $derived(
    planChecks(plan, issues).map((check) => ({
      ...check,
      targets: warningTargets(plan, {
        code: check.code,
        message: '',
        entityIds: [
          ...new Set(
            issues
              .filter((issue) => check.warningKeys.includes(warningKey(issue)))
              .flatMap((issue) => issue.entityIds)
          )
        ]
      }).filter((target) => target.entity.id !== activity.id)
    }))
  );
  let chooser = $state<{ key: number; requirementId?: string } | null>(null);
  let chooserKey = 0;
  let chooserOpener: HTMLElement | null = null;
  let genericAssign: HTMLButtonElement;
  const chosenRequirement = $derived(requirements.find((row) => row.id === chooser?.requirementId));
  const outstanding = $derived(
    chosenRequirement
      ? Math.max(
          0,
          chosenRequirement.quantity - allocatedHere(plan, activity.id, chosenRequirement.name)
        )
      : undefined
  );
  function chooseFood(opener: HTMLElement, requirementId?: string) {
    chooserOpener = opener;
    chooser = { key: ++chooserKey, requirementId };
  }
  async function closeChooser() {
    chooser = null;
    await tick();
    const opener = chooserOpener?.isConnected ? chooserOpener : genericAssign;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    chooserOpener = null;
  }
  function changeNumber(
    event: Event & { currentTarget: HTMLInputElement },
    old: number,
    change: (amount: number) => boolean
  ) {
    const input = event.currentTarget;
    if (
      !input.checkValidity() ||
      !Number.isFinite(input.valueAsNumber) ||
      !change(input.valueAsNumber)
    )
      input.value = String(old);
  }
  function changeStart(event: Event & { currentTarget: HTMLInputElement }, part: 'day' | 'minute') {
    const input = event.currentTarget;
    try {
      if (
        !input.checkValidity() ||
        !input.value ||
        !onpatch({
          start: {
            ...activity.start,
            [part]: part === 'minute' ? parseTime(input.value) : input.value
          }
        })
      )
        throw new Error();
    } catch {
      input.value = part === 'day' ? activity.start.day : formatTime(activity.start.minute);
    }
  }
</script>

<Popover {anchor} label="Activity" identity={activity.title} {onclose}>
  {#snippet header()}
    <p class="popover-eyebrow">
      {activity.kind === 'cook' ? 'Make something good' : 'In your plan'}
    </p>
    <input
      class="edit-title"
      aria-label="Activity name"
      maxlength="100"
      value={activity.title}
      onchange={(e) => {
        if (!onpatch({ title: e.currentTarget.value.trim() }))
          e.currentTarget.value = activity.title;
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  {/snippet}
  {#snippet children()}
    <details class="move-details" bind:this={schedule} bind:open={scheduleOpen}>
      <summary
        ><Icon name="calendar" size={14} />{dateLabel(activity.start.day)} / {formatTime(
          activity.start.minute
        )} - {endLabel(activity.start, activity.elapsedMinutes)}
        <Icon name="edit" size={12} /> Edit date / time</summary
      >
      <div class="inline-fields">
        <input
          type="date"
          aria-label="Activity date"
          min="0001-01-01"
          max="9998-12-31"
          required
          value={activity.start.day}
          onchange={(e) => changeStart(e, 'day')}
        /><input
          type="time"
          aria-label="Activity time"
          required
          value={formatTime(activity.start.minute)}
          onchange={(e) => changeStart(e, 'minute')}
        />
      </div>
    </details>
    <div class="time-pills">
      <label
        ><Icon name="clock" size={13} /><input
          type="number"
          aria-label="Duration minutes"
          min="0"
          max={MAX_ACTIVITY_MINUTES}
          required
          value={activity.elapsedMinutes}
          onchange={(e) =>
            changeNumber(e, activity.elapsedMinutes, (elapsedMinutes) =>
              onpatch({ elapsedMinutes })
            )}
        /> minutes</label
      >
    </div>

    {@render producedFood()}
    {@render allocatedFood()}

    <section class="compact-section activity-inputs">
      <div class="assign-heading">
        <h3>Food for this activity</h3>
        <button
          bind:this={genericAssign}
          class="secondary-button"
          onclick={(event) => chooseFood(event.currentTarget)}
          ><Icon name="plus" size={14} /> Assign food</button
        >
      </div>
      <p class="quiet small">
        {uses.length + inputs.length
          ? `${uses.length + inputs.length} saved allocations`
          : 'No food allocated yet.'} / Planning notes below are not stock.
      </p>
      {#if uses.length || inputs.length}<p class="activity-food-summary">
          {[
            ...uses.map(
              (use) =>
                `${quantity(use.quantity)} ${plan.ingredients.find((item) => item.id === use.ingredientId)?.name ?? 'ingredient'}`
            ),
            ...inputs.map(
              (use) =>
                `${quantity(use.quantity)} ${plan.batches.find((item) => item.id === use.batchId)?.name ?? 'prepared food'}`
            )
          ].join(' / ')}
        </p>{/if}
      {#if requirements.length}
        <h3 class="needs-heading">Ingredients needed</h3>
        {#each requirements as row (row.id)}
          <div class="requirement-summary">
            <div>
              <strong>{row.name}</strong><small
                >{quantity(row.quantity)} needed / {quantity(
                  allocatedHere(plan, activity.id, row.name)
                )} allocated here</small
              >
            </div>
            <button
              class="text-button"
              aria-label={`Assign ${row.name}`}
              onclick={(event) => chooseFood(event.currentTarget, row.id)}>Assign</button
            >
          </div>
        {/each}
      {/if}
      <details class="extra-details">
        <summary>Edit ingredient notes</summary>
        <p class="quiet small">Planning notes, not pantry stock or food used here.</p>
        <IngredientListEditor
          rows={requirements}
          context="Activity"
          draftKey={`activity:${activity.id}`}
          onpatch={onrequirement}
          onadd={onaddrequirement}
          onremove={onremoverequirement}
        />
      </details>
      {#if chooser}
        {#key chooser.key}<AssignFood
            {plan}
            activityId={activity.id}
            initialSearch={chosenRequirement?.name ?? ''}
            need={outstanding}
            {onassign}
            onclose={closeChooser}
          />{/key}
      {/if}
    </section>

    {#if issues.length}<h3 class="warning-heading">
        <Icon name="alert" size={14} /> Things to check
      </h3>{/if}
    {#each notices as notice}<section
        class="inline-warning activity-notice"
        data-warning-code={notice.code}
      >
        <strong><Icon name="alert" size={14} />{notice.title}</strong>
        <div class="notice-actions">
          {#each notice.targets as target}<button
              class="text-button"
              onclick={() => onnavigate(target.entity, target.at)}>Open {target.label}</button
            >{/each}
        </div>
      </section>{/each}

    {#snippet producedFood()}
      {#each outputs as batch (batch.id)}
        {@const total = batchTotals(plan, batch.id)}
        {@const remaining = displayBalance(batch.quantity, total.assigned)}
        <section class="compact-section">
          <div class="batch-heading">
            <Icon name="bowl" size={16} /><label
              ><input
                class="quantity-input"
                aria-label={`Amount made of ${batch.name}`}
                type="number"
                min="0.001"
                step="any"
                required
                value={batch.quantity}
                onchange={(e) =>
                  changeNumber(e, batch.quantity, (amount) =>
                    onbatch(batch.id, { quantity: amount })
                  )}
              />
              made</label
            ><small
              >{remaining < 0
                ? `${quantity(-remaining, batch.quantity)} over-assigned`
                : `${quantity(remaining, batch.quantity)} unplanned`}</small
            >
          </div>
          <button class="text-button" onclick={() => onnavigate({ kind: 'batch', id: batch.id })}
            >{batch.name}</button
          >
          <p class="quiet small">Planned output / ready {fullTime(batchReadyAt(plan, batch)!)}</p>
          <div class="output-actions">
            <button class="plan-meal-button" onclick={() => onplanmeal(batch.id)}
              ><Icon name="plus" size={14} /> Plan a meal from this <Icon
                name="arrow"
                size={14}
              /></button
            >
            <button class="text-button" onclick={() => oneathere(batch.id)}>Eat 2 here</button>
          </div>
          {#each plan.allocations.filter((a) => a.batchId === batch.id) as allocation (allocation.id)}
            {@const target = plan.activities.find((a) => a.id === allocation.activityId)}
            <RelationshipRow
              selection={{ allocationIds: [allocation.id], ingredientUseIds: [] }}
              label={`${quantity(allocation.quantity)} ${batch.name} to ${target?.title ?? 'missing activity'} / ${allocationDescription(plan, allocation)}`}
              {onpreview}
            >
              <button
                class="allocation-destination"
                onclick={() =>
                  target &&
                  onnavigate({ kind: 'activity', id: target.id }, allocationAt(plan, allocation))}
                >{target?.title ?? 'Missing activity'}<small
                  >{allocationDescription(plan, allocation)}</small
                ></button
              ><input
                aria-label={`Amount for ${target?.title ?? 'activity'} from ${batch.name}`}
                type="number"
                min="0"
                step="any"
                required
                value={allocation.quantity}
                onchange={(e) =>
                  changeNumber(e, allocation.quantity, (amount) =>
                    onallocation(allocation.id, amount)
                  )}
              /><button
                class="icon-button tiny"
                aria-label={`Remove allocation ${allocation.id}`}
                onclick={() => onallocation(allocation.id, 0)}
                ><Icon name="close" size={12} /></button
              >
            </RelationshipRow>
          {/each}
        </section>
      {/each}
    {/snippet}

    {#snippet allocatedFood()}
      {#if uses.length || inputs.length}
        <section class="compact-section">
          <h3>Food allocated here</h3>
          {#each uses as use (use.id)}
            {@const ingredient = plan.ingredients.find((item) => item.id === use.ingredientId)}
            <RelationshipRow
              selection={{ allocationIds: [], ingredientUseIds: [use.id] }}
              label={`${quantity(use.quantity)} ${ingredient?.name} allocated to ${activity.title}`}
              {onpreview}
            >
              <button
                class="allocation-destination"
                onclick={() => onnavigate({ kind: 'ingredient', id: use.ingredientId })}
                ><Icon name="leaf" size={13} /> {ingredient?.name}</button
              ><input
                aria-label={`Amount of ${ingredient?.name} used`}
                type="number"
                min="0"
                step="any"
                required
                value={use.quantity}
                onchange={(e) =>
                  changeNumber(e, use.quantity, (amount) => oningredient(use.id, amount))}
              /><button
                class="icon-button tiny"
                aria-label={`Remove ${ingredient?.name} from activity`}
                onclick={() => oningredient(use.id, 0)}><Icon name="close" size={12} /></button
              >
            </RelationshipRow>
          {/each}
          {#each inputs as allocation (allocation.id)}
            {@const batch = plan.batches.find((b) => b.id === allocation.batchId)}
            {@const sourceId = batch?.source.kind === 'activity' ? batch.source.activityId : null}
            {@const producer = plan.activities.find((item) => item.id === sourceId)}
            <RelationshipRow
              selection={{ allocationIds: [allocation.id], ingredientUseIds: [] }}
              label={`${quantity(allocation.quantity)} ${batch?.name} from ${producer?.title ?? 'stock at home'} / ${allocationDescription(plan, allocation)}`}
              {onpreview}
            >
              <div class="allocation-destination">
                <button
                  class="text-button"
                  onclick={() => onnavigate({ kind: 'batch', id: allocation.batchId })}
                  ><Icon name="bowl" size={13} /> {batch?.name}</button
                >
                {#if producer && batch}<button
                    class="text-button"
                    onclick={() =>
                      onnavigate({ kind: 'activity', id: producer.id }, batchReadyAt(plan, batch))}
                    >From {producer.title} / ready {fullTime(batchReadyAt(plan, batch)!)}</button
                  >{:else}<small>From stock at home</small>{/if}
                <small>{allocationDescription(plan, allocation)}</small>
              </div>
              <input
                aria-label={`Amount of ${batch?.name} used`}
                type="number"
                min="0"
                step="any"
                required
                value={allocation.quantity}
                onchange={(e) =>
                  changeNumber(e, allocation.quantity, (amount) =>
                    onallocation(allocation.id, amount)
                  )}
              /><button
                class="icon-button tiny"
                aria-label={`Remove ${batch?.name} from activity`}
                onclick={() => onallocation(allocation.id, 0)}
                ><Icon name="close" size={12} /></button
              >
            </RelationshipRow>
          {/each}
        </section>
      {/if}
    {/snippet}
    <details class="extra-details">
      <summary>More details</summary>
      <label class="field"
        >Notes and instructions<textarea
          aria-label="Activity notes"
          value={activity.notes}
          onchange={(e) => onpatch({ notes: e.currentTarget.value })}></textarea></label
      >
      {#each outputs as batch (batch.id)}
        <div class="batch-options">
          <label class="field"
            >Food name<input
              value={batch.name}
              aria-label={`Food name ${batch.id}`}
              onchange={(e) => {
                if (!onbatch(batch.id, { name: e.currentTarget.value.trim() }))
                  e.currentTarget.value = batch.name;
              }}
            /></label
          >
          <div class="split-actions">
            <button class="text-button danger" onclick={() => onremovebatch(batch.id)}
              >Remove this output</button
            >
          </div>
        </div>
      {/each}
      <button class="text-button" onclick={onaddbatch}
        ><Icon name="plus" size={13} /> Add a food output</button
      >
    </details>
    <div class="popover-footer">
      <span>Changes apply immediately</span><button class="text-button danger" onclick={ondelete}
        ><Icon name="trash" size={13} /> Delete</button
      >
    </div>
  {/snippet}
</Popover>
