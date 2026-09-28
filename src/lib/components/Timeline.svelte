<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { formatTime, todayDay } from '$lib/calendar';
  import { allocationAt, batchReadyAt, type LocalTime, type Warning } from '$lib/domain';
  import { fullTime, type EntityRef } from '$lib/relationships';
  import {
    routeConnection,
    placeConnectionLabel,
    type ConnectionRect,
    type ConnectionAnchor,
    type ConnectionColumn
  } from '$lib/connection-layout';
  import type { KitchenPlan } from '$lib/kitchen';
  import {
    DAY_HEIGHT,
    DAY_GUTTER,
    MIN_DAY_WIDTH,
    MIN_CARD_HEIGHT,
    TIME_RAIL_WIDTH,
    HOUR_HEIGHT,
    PX_PER_MINUTE,
    layoutActivities,
    layoutBlockers,
    segmentForDay,
    snapMinute,
    endLabel,
    endpointSegmentDay,
    type ResizeEdge
  } from '$lib/time-layout';
  import {
    dateLabel,
    groupFoodConnections,
    quantity,
    shortWarning,
    warningsFor,
    type FoodConnectionGroup
  } from '$lib/view';
  import Icon from './Icon.svelte';

  export type DragPreview = {
    id?: string;
    kind: 'activity' | 'block';
    start: LocalTime;
    duration: number;
    label: string;
  };
  let {
    plan,
    days,
    selectedId,
    related,
    focusedAllocationIds,
    warnings,
    mode,
    preview,
    dropTargetId,
    onselect,
    onhover,
    onleave,
    onkeyboard,
    onblock,
    onblank,
    onactivitydrag,
    onblockdrag,
    onrangedrag,
    onnavigate
  }: {
    plan: KitchenPlan;
    days: string[];
    selectedId: string | null;
    related: Set<string>;
    focusedAllocationIds: Set<string>;
    warnings: Warning[];
    mode: 'activity' | 'meal';
    preview: DragPreview | null;
    dropTargetId: string | null;
    onselect: (id: string, anchor: HTMLElement) => void;
    onhover: (id: string | null, event: PointerEvent) => void;
    onleave: (id: string, event: PointerEvent) => void;
    onkeyboard: (id: string | null, nextTarget?: EventTarget | null) => void;
    onblock: (id: string, anchor: HTMLElement) => void;
    onblank: (start: LocalTime, anchor: HTMLElement) => void;
    onactivitydrag: (event: PointerEvent, id: string, edge?: ResizeEdge) => void;
    onblockdrag: (event: PointerEvent, id: string, edge?: ResizeEdge) => void;
    onrangedrag: (event: PointerEvent) => void;
    onnavigate: (target: EntityRef, at?: LocalTime) => void;
  } = $props();
  const columnTemplate = $derived(
    `${TIME_RAIL_WIDTH}px repeat(${days.length}, minmax(${MIN_DAY_WIDTH}px, 1fr))`
  );
  let scroll: HTMLDivElement;
  let canvas: HTMLDivElement;
  let observer: ResizeObserver;
  let frame: number | undefined;
  type Connection = {
    key: string;
    parts: FoodConnectionGroup['parts'];
    labels: string[];
    d: string;
    label: { x: number; y: number } | null;
    conflict: boolean;
    emphasized: boolean;
  };
  let connections = $state<Connection[]>([]);
  const daysWithCards = $derived(
    days.map((day) => ({ day, cards: layoutActivities(plan.activities, day) }))
  );
  function endpointDay(id: string, at: LocalTime | undefined, currentPlan = plan) {
    const activity = currentPlan.activities.find((item) => item.id === id);
    return activity && at
      ? endpointSegmentDay(activity.start, activity.elapsedMinutes, at, days)
      : undefined;
  }
  function blank(event: MouseEvent, day: string) {
    const button = event.currentTarget as HTMLElement;
    const minute =
      event.detail === 0
        ? 12 * 60
        : snapMinute((event.clientY - button.getBoundingClientRect().top) / PX_PER_MINUTE);
    onblank({ day, minute }, button);
  }
  function outsideLinks(id: string) {
    return plan.allocations.flatMap((allocation) => {
      if (!focusedAllocationIds.has(allocation.id)) return [];
      const batch = plan.batches.find((b) => b.id === allocation.batchId);
      if (!batch || batch.source.kind !== 'activity') return [];
      const producerId = batch.source.activityId;
      if (producerId === allocation.activityId) return [];
      const otherId =
        producerId === id
          ? allocation.activityId
          : allocation.activityId === id
            ? producerId
            : null;
      const other = plan.activities.find((a) => a.id === otherId);
      const sourceAt = batchReadyAt(plan, batch);
      const targetAt = allocationAt(plan, allocation);
      const currentAt = producerId === id ? sourceAt : targetAt;
      const otherAt = producerId === id ? targetAt : sourceAt;
      return other && endpointDay(id, currentAt) && !endpointDay(other.id, otherAt) && otherAt
        ? [
            {
              id: allocation.id,
              target: { kind: 'activity' as const, id: other.id },
              at: otherAt,
              text: `${quantity(allocation.quantity)} ${batch.name} / ${producerId === id ? 'To' : 'From'} ${other.title} / ${producerId === id ? `${allocation.purpose} at ${allocation.when}` : 'ready'} ${fullTime(otherAt)}`
            }
          ]
        : [];
    });
  }
  const offRangeLinks = $derived([
    ...new Map(
      plan.activities
        .flatMap((activity) => outsideLinks(activity.id))
        .map((link) => [link.id, link])
    ).values()
  ]);
  const offRangeKey = $derived(offRangeLinks.map((link) => link.id).join('|'));
  let relationshipOrigin: { x: number; y: number } | undefined;
  let overlayPlacement = $state({ left: 12, top: 100, width: 280, maxHeight: 148 });
  let overlayOrigin: typeof relationshipOrigin;
  // Freeze the opposite corner for this relationship context, not every pointer step.
  $effect(() => {
    if (!offRangeKey) return;
    overlayOrigin = relationshipOrigin;
    positionOverlay();
  });
  function positionOverlay() {
    if (!scroll || !canvas) return;
    const area = scroll.getBoundingClientRect();
    const shell = scroll.closest('.calendar-shell')!.getBoundingClientRect();
    const header = canvas.querySelector('.calendar-header')!.getBoundingClientRect().height;
    const width = Math.min(360, area.width - 24);
    const maxHeight = Math.min(148, Math.max(60, (area.height - header - 32) / 2));
    const origin = overlayOrigin ?? { x: area.left, y: area.top };
    overlayPlacement = {
      left:
        origin.x < area.left + area.width / 2
          ? area.right - shell.left - width - 12
          : area.left - shell.left + 12,
      top:
        origin.y < area.top + header + (area.height - header) / 2
          ? area.bottom - shell.top - maxHeight - 12
          : area.top - shell.top + header + 12,
      width,
      maxHeight
    };
  }
  function measure() {
    if (!canvas?.isConnected) return;
    const routePlan =
      preview?.kind === 'activity' && preview.id
        ? {
            ...plan,
            activities: plan.activities.map((item) =>
              item.id === preview.id
                ? { ...item, start: preview.start, elapsedMinutes: preview.duration }
                : item
            )
          }
        : plan;
    const groups = groupFoodConnections(routePlan, focusedAllocationIds).sort((a, b) =>
      a.key.localeCompare(b.key)
    );
    if (!groups.length) {
      connections = [];
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const labelContext = document.createElement('canvas').getContext('2d');
    if (labelContext) labelContext.font = '12px "DM Sans Variable", sans-serif';
    const labelWidthFor = (text: string) =>
      labelContext?.measureText(text).width ?? text.length * 7;
    const columns: ConnectionColumn[] = Array.from(
      canvas.querySelectorAll<HTMLElement>('[data-time-day]'),
      (element) => {
        const rect = element.getBoundingClientRect();
        return { day: element.dataset.timeDay!, left: rect.left, right: rect.right };
      }
    );
    const anchorFor = (id: string, at?: LocalTime): ConnectionAnchor | undefined => {
      const endpoint = endpointDay(id, at, routePlan);
      if (!endpoint) return undefined;
      const element =
        preview?.kind === 'activity' && preview.id === id
          ? canvas.querySelector<HTMLElement>(`[data-time-day="${endpoint}"] .drag-preview`)
          : segmentElement('activity', id, at);
      const column = element?.closest<HTMLElement>('[data-time-day]');
      const day = column?.dataset.timeDay;
      return element && day && column
        ? {
            day,
            rect: element.getBoundingClientRect(),
            y: at
              ? column.getBoundingClientRect().top +
                (at.day === day ? at.minute : 1440) * PX_PER_MINUTE
              : undefined
          }
        : undefined;
    };
    const obstacles = Array.from(
      canvas.querySelectorAll<HTMLElement>('.time-card, .time-block, .drag-preview'),
      (element) => element.getBoundingClientRect()
    );
    const localObstacles = obstacles.map((rect) => ({
      left: rect.left - bounds.left,
      right: rect.right - bounds.left,
      top: rect.top - bounds.top,
      height: rect.height
    }));
    const occupied: ConnectionRect[] = [];
    const viewport = scroll.getBoundingClientRect();
    const headerHeight =
      canvas.querySelector('.calendar-header')?.getBoundingClientRect().height ?? 54;
    const labelBounds = {
      left: Math.max(TIME_RAIL_WIDTH, viewport.left - bounds.left) + 8,
      right: Math.min(bounds.width, viewport.right - bounds.left) - 8,
      top: Math.max(headerHeight, viewport.top - bounds.top + headerHeight) + 8,
      bottom: Math.min(bounds.height, viewport.bottom - bounds.top) - 8
    };
    connections = groups.flatMap((group, index) => {
      const batch = routePlan.batches.find((item) => item.id === group.parts[0].batchId);
      const source = anchorFor(group.sourceId, batch ? batchReadyAt(routePlan, batch) : undefined),
        target = anchorFor(group.targetId, allocationAt(routePlan, group.parts[0]));
      if (!source || !target) return [];
      const route = routeConnection(
        source,
        target,
        columns,
        bounds,
        { index, count: groups.length },
        obstacles
      );
      if (!route) return [];
      const labels = group.parts.map((part) => `${quantity(part.quantity)} ${part.batchName}`);
      const label = placeConnectionLabel(
        route,
        labelWidthFor(labels.join(' + ')) + 12,
        labelBounds,
        localObstacles,
        occupied
      );
      if (label) occupied.push(label.rect);
      return [
        {
          key: group.key,
          parts: group.parts,
          labels,
          d: route.d,
          label,
          emphasized: true,
          conflict: group.parts.some((part) =>
            warnings.some((w) => w.code === 'BEFORE_READY' && w.entityIds.includes(part.id))
          )
        }
      ];
    });
  }
  function focusOutsideRelationships(id: string) {
    const first = outsideLinks(id)[0];
    const link =
      first &&
      scroll
        .closest('.calendar-shell')
        ?.querySelector<HTMLButtonElement>(
          `.relationship-strip [data-allocation-id="${CSS.escape(first.id)}"]`
        );
    if (!link) return;
    link.focus({ preventScroll: true });
    const region = link.closest<HTMLElement>('.relationship-strip')!;
    const bounds = region.getBoundingClientRect(),
      rect = link.getBoundingClientRect();
    if (rect.top < bounds.top) region.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom) region.scrollTop += rect.bottom - bounds.bottom;
  }
  function queueMeasure() {
    if (frame !== undefined || !canvas?.isConnected) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  }
  function segmentElement(kind: 'activity' | 'block', id: string, at?: LocalTime) {
    const attribute = kind === 'activity' ? 'data-activity-id' : 'data-blocker-id';
    const elements = Array.from(
      canvas?.querySelectorAll<HTMLElement>(`[${attribute}="${CSS.escape(id)}"]`) ?? []
    );
    if (!at) return elements[0];
    const item =
      kind === 'activity'
        ? plan.activities.find((activity) => activity.id === id)
        : plan.blockers.find((blocker) => blocker.id === id);
    const day =
      item &&
      endpointSegmentDay(
        item.start,
        'elapsedMinutes' in item ? item.elapsedMinutes : item.durationMinutes,
        at,
        days
      );
    return elements.find(
      (element) => element.closest<HTMLElement>('[data-time-day]')?.dataset.timeDay === day
    );
  }
  function reveal(kind: 'activity' | 'block', id: string, at?: LocalTime) {
    const element = segmentElement(kind, id, at);
    if (!element || !scroll) return;
    const rect = element.getBoundingClientRect(),
      bounds = scroll.getBoundingClientRect();
    const header = canvas.querySelector('.calendar-header')?.getBoundingClientRect().height ?? 54;
    const column = element.closest<HTMLElement>('[data-time-day]');
    const day = column?.dataset.timeDay;
    const point =
      at && column
        ? column.getBoundingClientRect().top +
          (at.day === day ? at.minute : at.day > day! ? 1440 : 0) * PX_PER_MINUTE
        : rect.top;
    const top = Math.max(rect.top, Math.min(point, rect.bottom - 8));
    if (top < bounds.top + header + 12) scroll.scrollTop += top - (bounds.top + header + 12);
    else if (Math.min(rect.bottom, top + 36) > bounds.bottom - 12)
      scroll.scrollTop += Math.min(rect.bottom, top + 36) - (bounds.bottom - 12);
    if (rect.left < bounds.left + TIME_RAIL_WIDTH + 8)
      scroll.scrollLeft += rect.left - (bounds.left + TIME_RAIL_WIDTH + 8);
    else if (rect.right > bounds.right - 8) scroll.scrollLeft += rect.right - (bounds.right - 8);
    return (
      element.querySelector<HTMLElement>(kind === 'activity' ? '.time-card-main' : '.block-main') ??
      undefined
    );
  }
  // Off-range actions live outside the cards, so their context must survive travel
  // through the calendar's empty space and keyboard scroll entry point.
  export function hasOutsideRelationships() {
    return offRangeLinks.length > 0;
  }
  export function revealActivity(id: string, at?: LocalTime) {
    return reveal('activity', id, at);
  }
  export function revealBlock(id: string, at?: LocalTime) {
    return reveal('block', id, at);
  }
  export function revealDay(day: string) {
    const column = canvas?.querySelector<HTMLElement>(`[data-time-day="${day}"]`);
    if (column && scroll) scroll.scrollLeft = Math.max(0, column.offsetLeft - TIME_RAIL_WIDTH);
  }
  onMount(() => {
    scroll.scrollTop = 12 * HOUR_HEIGHT;
    observer = new ResizeObserver(() => {
      queueMeasure();
      positionOverlay();
    });
    observer.observe(canvas);
    observer.observe(scroll);
    document.fonts.ready.then(queueMeasure);
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });
  $effect(() => {
    void plan;
    void days;
    void focusedAllocationIds;
    void warnings;
    void preview;
    let cancelled = false;
    tick().then(() => {
      if (!cancelled) queueMeasure();
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if offRangeLinks.length}
  <section
    class="relationship-strip"
    aria-label="Food relationships outside this range"
    style:left={`${overlayPlacement.left}px`}
    style:top={`${overlayPlacement.top}px`}
    style:width={`${overlayPlacement.width}px`}
    style:max-height={`${overlayPlacement.maxHeight}px`}
  >
    {#each offRangeLinks as link (link.id)}
      <button
        class="outside-link"
        data-allocation-id={link.id}
        onclick={() => onnavigate(link.target, link.at)}
        onblur={(event) => {
          if (!(
            event.relatedTarget instanceof Element &&
            event.relatedTarget.closest('.relationship-strip, .time-card')
          ))
            onkeyboard(null, event.relatedTarget);
        }}
      >
        {link.text}
        <Icon name="arrow" size={14} />
      </button>
    {/each}
  </section>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Focusable region supports keyboard scrolling; day buttons provide keyboard creation.) -->
<div
  class="calendar-scroll"
  class:meal-mode={mode === 'meal'}
  bind:this={scroll}
  role="region"
  aria-label="Time-based planner"
  tabindex="0"
  onscroll={queueMeasure}
>
  <div
    class="calendar-grid"
    bind:this={canvas}
    style:grid-template-columns={columnTemplate}
    style:column-gap={`${DAY_GUTTER}px`}
    style:--day-gutter={`${DAY_GUTTER}px`}
    style:padding-right={`${DAY_GUTTER}px`}
    style:min-width={`${TIME_RAIL_WIDTH + days.length * (MIN_DAY_WIDTH + DAY_GUTTER) + DAY_GUTTER}px`}
  >
    <div
      class="calendar-header"
      style:grid-template-columns={columnTemplate}
      style:column-gap={`${DAY_GUTTER}px`}
    >
      <div class="time-corner"><Icon name="clock" size={14} /></div>
      {#each days as day}
        <header class="calendar-day-header" class:today={day === todayDay()}>
          <div>
            <span>{dateLabel(day, { weekday: 'short' })}</span><strong
              >{dateLabel(day, { day: 'numeric' })}</strong
            >
          </div>
        </header>
      {/each}
    </div>
    <div class="hour-rail" style:height={`${DAY_HEIGHT}px`}>
      {#each Array.from({ length: 24 }, (_, i) => i) as hour}<span
          style:top={`${hour * HOUR_HEIGHT}px`}>{formatTime(hour * 60)}</span
        >{/each}
    </div>
    {#each daysWithCards as column (column.day)}
      <div
        class="calendar-day"
        data-time-day={column.day}
        data-day={column.day}
        style:height={`${DAY_HEIGHT}px`}
        style:--hour-height={`${HOUR_HEIGHT}px`}
      >
        <button
          class="empty-calendar"
          aria-label={`Add at a time on ${column.day}`}
          onclick={(event) => blank(event, column.day)}
          onpointerdown={onrangedrag}
          ><span class="sr-only">Click or drag a time to add an activity</span></button
        >
        {#each layoutBlockers(plan.blockers, column.day) as segment (segment.blocker.id)}
          {@const blocker = segment.blocker}
          {#if segment}
            <div
              class="time-block"
              class:moving={preview?.id === blocker.id}
              style:top={`${segment.start * PX_PER_MINUTE}px`}
              style:height={`${(segment.end - segment.start) * PX_PER_MINUTE}px`}
              style:left={`calc(${(segment.lane / segment.lanes) * 100}% + 4px)`}
              style:width={`calc(${100 / segment.lanes}% - 8px)`}
              data-blocker-id={blocker.id}
              data-testid={`block-${blocker.id}`}
            >
              <button
                class="block-main"
                onclick={(event) => onblock(blocker.id, event.currentTarget)}
                onpointerdown={(event) => onblockdrag(event, blocker.id)}
                aria-label={`Edit blocker ${blocker.title}`}
                ><span class="drag-grip" data-drag-handle><Icon name="grip" size={13} /></span><span
                  ><strong>{blocker.title}</strong><small
                    >{formatTime(blocker.start.minute)} - {endLabel(
                      blocker.start,
                      blocker.durationMinutes
                    )}</small
                  ></span
                ></button
              >
              {#if !segment.continues}<button
                  class="resize-handle resize-start"
                  data-drag-handle
                  aria-label={`Resize start of blocker ${blocker.title}`}
                  title="Drag start; tap to edit duration"
                  onpointerdown={(event) => onblockdrag(event, blocker.id, 'start')}
                  onclick={(event) => onblock(blocker.id, event.currentTarget)}
                  ><span></span></button
                >{/if}
              {#if !segment.continuesAfter}<button
                  class="resize-handle resize-end"
                  data-drag-handle
                  aria-label={`Resize end of blocker ${blocker.title}`}
                  title="Drag end; tap to edit duration"
                  onpointerdown={(event) => onblockdrag(event, blocker.id, 'end')}
                  onclick={(event) => onblock(blocker.id, event.currentTarget)}
                  ><span></span></button
                >{/if}
            </div>
          {/if}
        {/each}
        {#each column.cards as card (`${column.day}-${card.activity.id}`)}
          {@const activity = card.activity}
          {@const outputs = plan.batches.filter(
            (batch) => batch.source.kind === 'activity' && batch.source.activityId === activity.id
          )}
          {@const inputs = plan.allocations.filter(
            (allocation) =>
              allocation.activityId === activity.id &&
              !outputs.some((batch) => batch.id === allocation.batchId)
          )}
          {@const issues = warningsFor(plan, warnings, activity.id)}
          {@const naturalHeight = (card.end - card.start) * PX_PER_MINUTE}
          <article
            class="time-card {activity.kind}"
            class:selected={selectedId === activity.id}
            class:related={related.has(activity.id) && selectedId !== activity.id}
            class:has-warning={issues.length > 0}
            class:short-duration={naturalHeight < 24}
            class:long-duration={naturalHeight >= 240}
            class:drop-target={dropTargetId === activity.id}
            class:moving={preview?.id === activity.id}
            style:top={`${card.start * PX_PER_MINUTE}px`}
            style:height={`${Math.max(MIN_CARD_HEIGHT, naturalHeight)}px`}
            style:left={`calc(${(card.lane / card.lanes) * 100}% + 7px)`}
            style:width={`calc(${100 / card.lanes}% - 14px)`}
            data-activity-id={activity.id}
            data-testid={`activity-${activity.id}`}
            onpointermove={(event) => {
              relationshipOrigin = { x: event.clientX, y: event.clientY };
              onhover(activity.id, event);
            }}
          >
            <button
              class="time-card-main"
              aria-label={`Edit ${activity.title}`}
              aria-pressed={selectedId === activity.id}
              onclick={(event) => onselect(activity.id, event.currentTarget)}
              onpointerdown={(event) => onactivitydrag(event, activity.id)}
              onfocus={(event) => {
                if (event.currentTarget.matches(':focus-visible')) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  relationshipOrigin = {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2
                  };
                  onkeyboard(activity.id);
                }
              }}
              onblur={(event) => {
                if (!(
                  event.relatedTarget instanceof Element &&
                  event.relatedTarget.closest('.relationship-strip, .time-card')
                ))
                  onkeyboard(null, event.relatedTarget);
              }}
            >
              <span class="time-card-copy">
                <span class="time-card-title"
                  ><strong>{activity.title}</strong>{#if issues.length}<span
                      class="warning-dot"
                      title={issues.map((issue) => issue.message).join('\n')}
                      ><Icon name="alert" size={12} /></span
                    >{/if}</span
                >
                <span class="time-card-meta"
                  >{#if naturalHeight >= 240 && card.continues}
                    {card.continuesAfter ? 'Until' : 'Ends'}
                    {card.end === 1440 ? '24:00' : formatTime(card.end)}
                  {:else}{card.continues ? 'Continues' : formatTime(activity.start.minute)} - {endLabel(
                      activity.start,
                      activity.elapsedMinutes
                    )}{/if}</span
                >
                {#if outputs.length}<span class="time-card-food"
                    >{outputs
                      .map((batch) => `${quantity(batch.quantity)} ${batch.name}`)
                      .join(' / ')}</span
                  >{/if}
                {#if !outputs.length && inputs.length}<span class="time-card-food"
                    >{inputs
                      .map(
                        (input) =>
                          `${quantity(input.quantity)} ${plan.batches.find((batch) => batch.id === input.batchId)?.name ?? 'food'}`
                      )
                      .join(' / ')}</span
                  >{/if}
                {#if naturalHeight >= 100 && naturalHeight < 240 && issues.length}<span
                    class="card-issue-text">{shortWarning(issues[0].code)}</span
                  >{/if}
              </span>
              <span class="card-drag-grip drag-grip" data-drag-handle title="Drag to move"
                ><Icon name="grip" size={12} /></span
              >
            </button>
            {#if outsideLinks(activity.id).length}
              <button
                class="calendar-link-jump"
                aria-label={`Follow food outside these dates for ${activity.title}`}
                onclick={() => focusOutsideRelationships(activity.id)}
                >Linked dates <Icon name="arrow" size={13} /></button
              >
            {/if}
            {#if !card.continues}<button
                class="resize-handle resize-start"
                data-drag-handle
                aria-label={`Resize start of ${activity.title}`}
                title="Drag start; tap to edit duration"
                onpointerdown={(event) => onactivitydrag(event, activity.id, 'start')}
                onclick={(event) => onselect(activity.id, event.currentTarget)}
                ><span></span></button
              >{/if}
            {#if !card.continuesAfter}<button
                class="resize-handle resize-end"
                data-drag-handle
                style:top={`${naturalHeight - 12}px`}
                style:bottom="auto"
                aria-label={`Resize end of ${activity.title}`}
                title="Drag end; tap to edit duration"
                onpointerdown={(event) => onactivitydrag(event, activity.id, 'end')}
                onclick={(event) => onselect(activity.id, event.currentTarget)}
                ><span></span></button
              >{/if}
            <span
              class="duration-rail"
              style:height={`${Math.max(2, naturalHeight)}px`}
              aria-hidden="true"
            ></span>
          </article>
        {/each}
        {#if preview}
          {@const segment = segmentForDay(preview.start, preview.duration, column.day)}
          {#if segment}<div
              class="drag-preview {preview.kind}"
              style:top={`${segment.start * PX_PER_MINUTE}px`}
              style:height={`${Math.max(MIN_CARD_HEIGHT, (segment.end - segment.start) * PX_PER_MINUTE)}px`}
            >
              <strong>{preview.label}</strong><small
                >{formatTime(preview.start.minute)} - {endLabel(
                  preview.start,
                  preview.duration
                )}</small
              >
            </div>{/if}
        {/if}
      </div>
    {/each}
    <svg class="calendar-connections" aria-hidden="true"
      >{#if connections.length}<defs
          ><marker
            id="food-arrow"
            markerWidth="5"
            markerHeight="5"
            refX="4"
            refY="2.5"
            orient="auto"
            ><path d="M0 0L5 2.5L0 5Z" fill="var(--connection-arrow, #77906a)" /></marker
          ></defs
        >{/if}{#each connections as connection (connection.key)}<path
          class="food-connection"
          class:conflict={connection.conflict}
          class:emphasized={connection.emphasized}
          d={connection.d}
          marker-end="url(#food-arrow)"
          data-allocation-ids={JSON.stringify(connection.parts.map((part) => part.id))}
        />{#if connection.label}<text
            class="connection-label"
            class:emphasized={connection.emphasized}
            x={connection.label.x}
            y={connection.label.y}
            text-anchor="middle"
            >{#each connection.parts as part, index (part.id)}<tspan data-allocation-id={part.id}
                >{index ? ' + ' : ''}{connection.labels[index]}</tspan
              >{/each}</text
          >{/if}{/each}</svg
    >
  </div>
</div>
