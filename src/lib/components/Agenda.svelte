<script lang="ts">
  import { formatTime, todayDay } from '$lib/calendar';
  import type { LocalTime, Warning } from '$lib/domain';
  import type { KitchenPlan } from '$lib/kitchen';
  import { endpointSegmentDay, segmentForDay } from '$lib/time-layout';
  import { dateLabel, quantity, shortWarning, warningsFor } from '$lib/view';
  let {
    plan,
    days,
    selectedId,
    related,
    warnings,
    onselect,
    onblock,
    onplan,
    onadd,
    onhover,
    onleave,
    onkeyboard
  }: {
    plan: KitchenPlan;
    days: string[];
    selectedId: string | null;
    related: Set<string>;
    warnings: Warning[];
    onselect: (id: string, anchor: HTMLElement) => void;
    onblock: (id: string, anchor: HTMLElement) => void;
    onplan: (day: string) => void;
    onadd: (day: string, anchor: HTMLElement) => void;
    onhover: (id: string | null, event: PointerEvent) => void;
    onleave: (id: string, event: PointerEvent) => void;
    onkeyboard: (id: string | null) => void;
  } = $props();
  let scroll: HTMLDivElement;
  const grouped = $derived(
    days.map((day) => ({
      day,
      entries: [
        ...plan.activities.map((item) => ({
          item,
          kind: 'activity' as const,
          duration: item.elapsedMinutes
        })),
        ...plan.blockers.map((item) => ({
          item,
          kind: 'block' as const,
          duration: item.durationMinutes
        }))
      ]
        .flatMap((entry) => {
          const segment = segmentForDay(entry.item.start, entry.duration, day);
          return segment ? [{ ...entry, segment }] : [];
        })
        .sort(
          (a, b) =>
            a.segment.start - b.segment.start ||
            a.segment.end - b.segment.end ||
            a.item.id.localeCompare(b.item.id)
        )
    }))
  );
  function foodSummary(id: string) {
    const outputIds = new Set(
      plan.batches
        .filter((item) => item.source.kind === 'activity' && item.source.activityId === id)
        .map((item) => item.id)
    );
    return [
      ...plan.batches
        .filter((item) => outputIds.has(item.id))
        .map((item) => `Makes ${quantity(item.quantity)} ${item.name}`),
      ...plan.ingredientUses
        .filter((use) => use.activityId === id)
        .map(
          (use) =>
            `${quantity(use.quantity)} ${plan.ingredients.find((item) => item.id === use.ingredientId)?.name ?? 'ingredient'}`
        ),
      ...plan.allocations
        .filter((use) => use.activityId === id && !outputIds.has(use.batchId))
        .map(
          (use) =>
            `${quantity(use.quantity)} ${plan.batches.find((item) => item.id === use.batchId)?.name ?? 'prepared food'}`
        )
    ].join(' / ');
  }
  function reveal(kind: 'activity' | 'block', id: string, at?: LocalTime) {
    const item =
      kind === 'activity'
        ? plan.activities.find((item) => item.id === id)
        : plan.blockers.find((item) => item.id === id);
    if (!item || !scroll) return;
    const day = at
      ? endpointSegmentDay(
          item.start,
          'elapsedMinutes' in item ? item.elapsedMinutes : item.durationMinutes,
          at,
          days
        )
      : days.find((day) =>
          segmentForDay(
            item.start,
            'elapsedMinutes' in item ? item.elapsedMinutes : item.durationMinutes,
            day
          )
        );
    const element = scroll.querySelector<HTMLElement>(
      `[data-agenda-day="${day}"] [data-${kind === 'activity' ? 'activity' : 'blocker'}-id="${CSS.escape(id)}"]`
    );
    if (element) {
      const rect = element.getBoundingClientRect(),
        bounds = scroll.getBoundingClientRect();
      scroll.scrollTop += rect.top - bounds.top - 54;
    }
    return element ?? undefined;
  }
  export function revealActivity(id: string, at?: LocalTime) {
    return reveal('activity', id, at);
  }
  export function revealBlock(id: string, at?: LocalTime) {
    return reveal('block', id, at);
  }
  export function revealDay(day: string) {
    const element = scroll?.querySelector<HTMLElement>(`[data-agenda-day="${day}"]`);
    if (element)
      scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  }
</script>

<div class="agenda-scroll" bind:this={scroll} role="region" aria-label="Agenda">
  {#each grouped as group (group.day)}
    <section class="agenda-day" data-agenda-day={group.day} aria-label={dateLabel(group.day)}>
      <header class="agenda-day-heading">
        <h3>
          {dateLabel(group.day, {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
          })}{#if group.day === todayDay()}
            <span>Today</span>{/if}
        </h3>
        <div class="agenda-day-actions">
          <button class="text-button" onclick={(event) => onadd(group.day, event.currentTarget)}
            >Add activity</button
          >
          <button class="text-button" onclick={() => onplan(group.day)}>Plan on calendar</button>
        </div>
      </header>
      {#each group.entries as entry (`${entry.kind}-${entry.item.id}`)}
        {@const issues = warningsFor(plan, warnings, entry.item.id)}
        <button
          class="agenda-entry"
          class:cook={entry.kind === 'activity' &&
            'kind' in entry.item &&
            entry.item.kind === 'cook'}
          class:meal={entry.kind === 'activity' &&
            'kind' in entry.item &&
            entry.item.kind === 'meal'}
          class:blocked={entry.kind === 'block'}
          class:selected={selectedId === entry.item.id}
          class:related={related.has(entry.item.id) && selectedId !== entry.item.id}
          data-activity-id={entry.kind === 'activity' ? entry.item.id : undefined}
          data-blocker-id={entry.kind === 'block' ? entry.item.id : undefined}
          data-testid={`agenda-${entry.item.id}`}
          aria-label={`Edit ${entry.kind === 'block' ? 'blocker ' : ''}${entry.item.title}${entry.segment.continues ? ' (continued)' : ''}`}
          onclick={(event) =>
            entry.kind === 'activity'
              ? onselect(entry.item.id, event.currentTarget)
              : onblock(entry.item.id, event.currentTarget)}
          onpointermove={(event) => onhover(entry.item.id, event)}
          onpointerleave={(event) => onleave(entry.item.id, event)}
          onfocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) onkeyboard(entry.item.id);
          }}
          onblur={() => onkeyboard(null)}
        >
          <span class="agenda-time"
            >{formatTime(entry.segment.start)} - {entry.segment.end === 1440
              ? '24:00'
              : formatTime(entry.segment.end)}</span
          >
          <strong>{entry.item.title}</strong>
          {#if entry.segment.continues || entry.segment.continuesAfter}<span
              class="agenda-continuation"
              >{entry.segment.continues ? 'Continued from previous day' : ''}{entry.segment
                .continues && entry.segment.continuesAfter
                ? ' / '
                : ''}{entry.segment.continuesAfter ? 'Continues tomorrow' : ''}</span
            >{/if}
          {#if entry.kind === 'activity' && foodSummary(entry.item.id)}<span class="agenda-food"
              >{foodSummary(entry.item.id)}</span
            >{/if}
          {#if entry.kind === 'block'}<span class="agenda-food">Blocked time</span>{/if}
          {#if issues.length}<span class="agenda-warning"
              >{issues
                .map((issue) =>
                  shortWarning(issue.code) === 'Check this activity'
                    ? issue.message
                    : shortWarning(issue.code)
                )
                .join(' / ')}</span
            >{/if}
        </button>
      {:else}<p class="agenda-empty">Nothing planned. There is room for something good.</p>{/each}
    </section>
  {/each}
</div>
