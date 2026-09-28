<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { formatTime, parseTime } from '$lib/calendar';
  import { MAX_ACTIVITY_MINUTES } from '$lib/domain';
  import type { Blocker } from '$lib/kitchen';
  import { dateLabel } from '$lib/view';
  import { endLabel } from '$lib/time-layout';
  import Popover from './Popover.svelte';
  import Icon from './Icon.svelte';
  let {
    blocker,
    reveal,
    anchor,
    onpatch,
    ondelete,
    onclose
  }: {
    blocker: Blocker;
    reveal?: 'schedule';
    anchor?: HTMLElement | null;
    onpatch: (patch: Partial<Blocker>) => boolean;
    ondelete: () => void;
    onclose: () => void;
  } = $props();
  let schedule: HTMLDetailsElement;
  let scheduleOpen = $state(untrack(() => reveal === 'schedule'));
  onMount(() => {
    let mounted = true;
    if (reveal === 'schedule')
      void tick().then(() => {
        if (mounted && schedule?.isConnected)
          schedule
            .querySelector<HTMLInputElement>('[aria-label="Blocker time"]')
            ?.focus({ preventScroll: true });
      });
    return () => {
      mounted = false;
    };
  });
</script>

<Popover {anchor} label="Blocked time" identity={blocker.title} {onclose}>
  {#snippet header()}
    <p class="popover-eyebrow">Time for something else</p>
    <input
      class="edit-title"
      aria-label="Blocker name"
      value={blocker.title}
      maxlength="100"
      onchange={(e) => {
        if (!onpatch({ title: e.currentTarget.value.trim() }))
          e.currentTarget.value = blocker.title;
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  {/snippet}
  <p class="quiet small">
    {dateLabel(blocker.start.day)} / {formatTime(blocker.start.minute)} - {endLabel(
      blocker.start,
      blocker.durationMinutes
    )}
  </p>
  <div class="time-pills">
    <label
      ><Icon name="clock" size={13} /><input
        type="number"
        aria-label="Blocked minutes"
        min="1"
        max={MAX_ACTIVITY_MINUTES}
        required
        value={blocker.durationMinutes}
        onchange={(e) => {
          if (
            !e.currentTarget.checkValidity() ||
            !onpatch({ durationMinutes: e.currentTarget.valueAsNumber })
          )
            e.currentTarget.value = String(blocker.durationMinutes);
        }}
      /> minutes blocked</label
    >
  </div>
  <details class="move-details" bind:this={schedule} bind:open={scheduleOpen}>
    <summary><Icon name="calendar" size={14} /> Edit blocked date / time</summary>
    <div class="inline-fields">
      <input
        type="date"
        aria-label="Blocker date"
        min="0001-01-01"
        max="9998-12-31"
        required
        value={blocker.start.day}
        onchange={(e) => {
          if (
            !e.currentTarget.checkValidity() ||
            !onpatch({ start: { ...blocker.start, day: e.currentTarget.value } })
          )
            e.currentTarget.value = blocker.start.day;
        }}
      /><input
        type="time"
        aria-label="Blocker time"
        required
        value={formatTime(blocker.start.minute)}
        onchange={(e) => {
          if (
            !e.currentTarget.checkValidity() ||
            !e.currentTarget.value ||
            !onpatch({ start: { ...blocker.start, minute: parseTime(e.currentTarget.value) } })
          )
            e.currentTarget.value = formatTime(blocker.start.minute);
        }}
      />
    </div>
  </details>
  <div class="popover-footer">
    <span>Drag either edge to resize</span><button class="text-button danger" onclick={ondelete}
      ><Icon name="trash" size={13} /> Delete</button
    >
  </div>
</Popover>
