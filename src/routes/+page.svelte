<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { parseKitchenPlan } from '$lib/plan-document';
  import { PlanSync, httpPlanTransport, type SyncState } from '$lib/plan-sync';
  import { addDays, addMinutes, formatTime, parseDay, startOfWeek, todayDay } from '$lib/calendar';
  import {
    batchTotals,
    batchReadyAt,
    removeBatch,
    MAX_ACTIVITY_MINUTES,
    type Activity,
    type Batch,
    type LocalTime
  } from '$lib/domain';
  import {
    deleteActivity,
    deleteBlocker,
    deleteIngredient,
    ingredientTotals,
    moveBlocker,
    parseIngredient,
    parsePreparedFood,
    validateKitchenPlan,
    type KitchenPlan,
    type Recipe,
    type RecipeIngredient,
    type ActivityRequirement,
    type Blocker
  } from '$lib/kitchen';
  import { createRecipe, instantiateRecipe } from '$lib/recipes';
  import {
    addBatchAssignment,
    addIngredientAssignment,
    patchIngredientUseAmount,
    patchAllocationAmount,
    entityRef,
    kitchenFocus,
    rangeForTarget,
    warningTargets,
    type EntityRef,
    type RelationSelection
  } from '$lib/relationships';
  import { pointerDrag, type DragPoint } from '$lib/drag';
  import {
    absoluteMinute,
    endpointSegmentDay,
    PX_PER_MINUTE,
    resizeSpan,
    snapMinute,
    type ResizeEdge
  } from '$lib/time-layout';
  import { dateLabel, newId, quantity } from '$lib/view';
  import Icon from '$lib/components/Icon.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import FoodTray from '$lib/components/FoodTray.svelte';
  import Timeline, { type DragPreview } from '$lib/components/Timeline.svelte';
  import Agenda from '$lib/components/Agenda.svelte';
  import QuickCreate, { type QuickKind } from '$lib/components/QuickCreate.svelte';
  import ActivityPopover from '$lib/components/ActivityPopover.svelte';
  import FoodPopover from '$lib/components/FoodPopover.svelte';
  import BlockPopover from '$lib/components/BlockPopover.svelte';
  import RecipesPopover from '$lib/components/RecipesPopover.svelte';
  import IssuesPopover from '$lib/components/IssuesPopover.svelte';
  import { setInspector, type InspectorDestination } from '$lib/inspector';
  import { type CheckAction, type ChecksSession } from '$lib/plan-checks';

  const anchorDay = startOfWeek(todayDay());
  let plan = $state<KitchenPlan>({
    activities: [],
    batches: [],
    allocations: [],
    availability: {},
    ingredients: [],
    ingredientUses: [],
    blockers: [],
    recipes: [],
    activityRequirements: []
  });
  let sync: PlanSync | undefined;
  let persistence = $state<SyncState>({
    phase: 'loading',
    loaded: false,
    dirty: false,
    recoveryUnavailable: false
  });
  const saveProblem = $derived(
    persistence.phase === 'error'
      ? persistence.loaded
        ? 'Could not save. Your edits are still in this tab. Retry when the server is available.'
        : 'Could not load your saved plan. Nothing on the server has been changed.'
      : persistence.phase === 'conflict'
        ? 'Another tab or device changed the plan. Your local edits have not overwritten it.'
        : persistence.phase === 'recovery-error'
          ? 'This tab has a recovery copy that cannot be read. Download it before loading the saved plan.'
          : persistence.recoveryUnavailable
            ? 'Browser recovery storage is unavailable. Wait for Saved before closing or refreshing this tab.'
            : ''
  );
  onMount(() => {
    let savedView: string | null = null;
    try {
      savedView = localStorage.getItem('meal-prep:view');
    } catch {
      /* Browsing works without storage. */
    }
    view =
      savedView === 'calendar' || savedView === 'agenda'
        ? savedView
        : window.innerWidth < 700
          ? 'agenda'
          : 'calendar';
    const key = 'meal-prep:unsaved-plan:v1';
    sync = new PlanSync({
      transport: httpPlanTransport(),
      drafts: {
        read: () => sessionStorage.getItem(key),
        write: (value) => sessionStorage.setItem(key, value),
        remove: () => sessionStorage.removeItem(key)
      },
      onState: (state) => {
        persistence = state;
      },
      onHydrate: (saved) => {
        plan = saved;
        history = [];
        inspection = null;
        cancelPlacement();
        void tick().then(() => {
          if (window.innerWidth < 700) activeView()?.revealDay(todayDay());
        });
        selectedId = null;
        hoveredId = null;
        lastActivityId = null;
      }
    });
    void sync.start();
    return () => {
      sync?.dispose();
    };
  });
  let startDay = $state(anchorDay);
  let dayCount = $state(7);
  let selectedId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let lastActivityId = $state<string | null>(null);
  let view = $state<'calendar' | 'agenda'>('calendar');
  let history = $state<KitchenPlan[]>([]);
  let assignment = $state<{
    kind: 'ingredient' | 'batch';
    id: string;
    amount: number;
    name: string;
  } | null>(null);
  let mode = $state<'activity' | 'meal'>('activity');
  let mealSourceId = $state<string | null>(null);
  type Inspection =
    | {
        key: string;
        kind: 'activity' | 'block' | 'ingredient' | 'batch';
        id: string;
        reveal?: CheckAction['reveal'];
        anchor?: HTMLElement | null;
      }
    | {
        key: string;
        kind: 'recipes';
        anchor?: HTMLElement | null;
      }
    | {
        key: string;
        kind: 'issues';
        anchor?: HTMLElement | null;
      }
    | {
        key: string;
        kind: 'quick';
        start: LocalTime;
        initialKind: QuickKind;
        draftKind: QuickKind;
        draftTitle: string;
        suppliedDuration: number;
        durationProvided: boolean;
        editableStart: boolean;
        previewDuration: number;
        previewValid: boolean;
        anchor?: HTMLElement | null;
      };
  let inspection = $state<Inspection | null>(null);
  let recipeSelectedId = $state<string | null>(null);
  let recipeNewName = $state('');
  let inspectorExpanded = $state(false);
  let ingredientDrafts = $state<Record<string, string>>({});
  let checksSession = $state<ChecksSession>({
    scrollTop: 0,
    focusKey: null,
    originKey: null,
    originTitle: '',
    originGroupKey: null,
    originRowTitle: null,
    originAt: null,
    returning: false,
    filter: 'all',
    orderedFocusKeys: [],
    focusOffset: null,
    expandedKeys: []
  });
  setInspector({
    get destination() {
      return inspection?.kind === 'recipes'
        ? 'recipes'
        : inspection?.kind === 'issues' || checksSession.originKey
          ? 'issues'
          : null;
    },
    get checkCount() {
      return warnings.length;
    },
    get backToChecks() {
      return (
        !!checksSession.originKey && inspection?.kind !== 'issues' && inspection?.kind !== 'recipes'
      );
    },
    get expanded() {
      return inspectorExpanded;
    },
    get ingredientDrafts() {
      return ingredientDrafts;
    },
    setIngredientDraft: (key, text) => {
      ingredientDrafts[key] = text;
    },
    setExpanded: (value) => {
      inspectorExpanded = value;
    },
    switchTo: (destination) => switchInspector(destination),
    back: () => {
      checksSession.returning = true;
      openIssues();
    }
  });
  $effect(() => {
    if (!inspection) {
      clearChecksContext();
      inspectorExpanded = false;
      recipeSelectedId = null;
    }
  });
  function clearChecksContext() {
    checksSession.originKey = null;
    checksSession.originTitle = '';
    checksSession.originGroupKey = null;
    checksSession.originRowTitle = null;
    checksSession.originAt = null;
    checksSession.returning = false;
  }
  function switchInspector(destination: InspectorDestination) {
    if (destination === 'recipes') openRecipes();
    else openIssues();
  }
  function navigateCheck(
    target: CheckAction,
    originKey: string,
    title: string,
    groupKey: string | null,
    rowTitle: string | null
  ) {
    checksSession.originKey = originKey;
    checksSession.originTitle = title;
    checksSession.originGroupKey = groupKey;
    checksSession.originRowTitle = rowTitle;
    checksSession.originAt = rowTitle ? (target.at ?? null) : null;
    void navigateEntity(target.entity, target.at, target.reveal);
  }
  let relationPreview = $state.raw<{
    owner: string;
    token: object;
    selection: RelationSelection;
    label: string;
  } | null>(null);
  const activeRelation = $derived(
    relationPreview?.owner === inspection?.key ? relationPreview : null
  );
  const focusId = $derived(assignment?.id ?? mealSourceId ?? selectedId ?? hoveredId);
  const focus = $derived(kitchenFocus(plan, entityRef(plan, focusId), activeRelation?.selection));
  const related = $derived(focus.entityIds);
  const focusLabel = $derived(
    activeRelation?.label ??
      (focusId
        ? `Direct food relationships for ${plan.activities.find((item) => item.id === focusId)?.title ?? plan.batches.find((item) => item.id === focusId)?.name ?? plan.ingredients.find((item) => item.id === focusId)?.name ?? 'this item'}`
        : 'Drag cards to move. Drag either edge to resize.')
  );
  function previewRelation(
    owner: string,
    token: object,
    selection: RelationSelection | null,
    label: string
  ) {
    if (inspection?.key !== owner) return;
    if (selection) relationPreview = { owner, token, selection, label };
    else if (relationPreview?.token === token) relationPreview = null;
  }
  function relationHandler(owner: string) {
    return (token: object, selection: RelationSelection | null, label: string) =>
      previewRelation(owner, token, selection, label);
  }
  function keyboardPreview(id: string | null, nextTarget?: EventTarget | null) {
    if (id === null && retainsRelationshipContext(nextTarget)) return;
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement.hasAttribute('data-restoring-focus')
    )
      return;
    if (!inspection && !dragBubble) hoveredId = id;
  }
  let notice = $state<{ text: string; error: boolean } | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let preview = $state<DragPreview | null>(null);
  const shownPreview: DragPreview | null = $derived(
    preview ??
      (inspection?.kind === 'quick' && inspection.previewValid
        ? {
            kind: inspection.draftKind === 'block' ? 'block' : 'activity',
            start: inspection.start,
            duration: inspection.previewDuration,
            label:
              inspection.draftTitle ||
              (inspection.draftKind === 'block' ? 'Blocked time' : 'New activity')
          }
        : null)
  );
  let dropTargetId = $state<string | null>(null);
  let dragBubble = $state<{ x: number; y: number; title: string; detail: string } | null>(null);
  let cancelGesture: (() => void) | undefined;
  let calendar = $state<Timeline>();
  let agenda = $state<Agenda>();
  function activeView() {
    return view === 'calendar' ? calendar : agenda;
  }
  async function setView(next: 'calendar' | 'agenda', day?: string) {
    flushEditor();
    if (inspection?.kind === 'quick') inspection = null;
    view = next;
    try {
      localStorage.setItem('meal-prep:view', next);
    } catch {
      /* Optional browser preference. */
    }
    await tick();
    if (day) activeView()?.revealDay(day);
    else if (selectedId && plan.activities.some((item) => item.id === selectedId))
      activeView()?.revealActivity(selectedId);
    else if (days.includes(todayDay())) activeView()?.revealDay(todayDay());
  }
  function planOnCalendar(day: string) {
    void setView('calendar', day);
  }
  const days = $derived(Array.from({ length: dayCount }, (_, index) => addDays(startDay, index)));
  const endDay = $derived(days[days.length - 1]);
  const warnings = $derived(validateKitchenPlan(plan));
  const rangeTitle = $derived(
    `${dateLabel(startDay, startDay.slice(0, 7) === endDay.slice(0, 7) ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} - ${dateLabel(endDay, { day: 'numeric', month: 'long' })}`
  );
  const mealSource = $derived(plan.batches.find((batch) => batch.id === mealSourceId));
  onDestroy(() => {
    cancelGesture?.();
    clearTimeout(noticeTimer);
  });

  function tell(text: string, error = false) {
    clearTimeout(noticeTimer);
    notice = { text, error };
    noticeTimer = setTimeout(() => (notice = null), error ? 7000 : 4000);
  }
  function commit(next: KitchenPlan, message?: string): boolean {
    try {
      const invalid = validateKitchenPlan(next).find(
        (issue) => issue.code.startsWith('INVALID_') || issue.code.startsWith('MISSING_')
      );
      if (invalid) throw new Error(invalid.message);
      const snapshot = parseKitchenPlan($state.snapshot(next));
      if (!sync) throw new Error('Wait for the saved plan to load.');
      sync.change(snapshot);
      history = [...history.slice(-29), $state.snapshot(plan)];
      plan = snapshot;
      relationPreview = null;
      if (
        (mealSourceId && !plan.batches.some((batch) => batch.id === mealSourceId)) ||
        (assignment &&
          !(assignment.kind === 'ingredient' ? plan.ingredients : plan.batches).some(
            (food) => food.id === assignment?.id
          ))
      )
        cancelPlacement();
      if (message) tell(message);
      return true;
    } catch (error) {
      tell(error instanceof Error ? error.message : 'That change could not be applied.', true);
      return false;
    }
  }
  function attempt(action: () => boolean): boolean {
    try {
      return action();
    } catch (error) {
      tell(error instanceof Error ? error.message : 'Check that value.', true);
      return false;
    }
  }
  function undo() {
    const previous = history[history.length - 1];
    if (!previous || !sync) return;
    try {
      sync.change($state.snapshot(previous));
    } catch {
      tell('Wait for the saved plan to load.', true);
      return;
    }
    inspection = null;
    selectedId = null;
    hoveredId = null;
    cancelPlacement();
    plan = previous;
    history = history.slice(0, -1);
    tell('Last change undone.');
  }
  function go(day: string, count = dayCount): boolean {
    try {
      parseDay(day);
      if (day < '0001-01-01' || !Number.isSafeInteger(count) || count < 1) throw new Error();
      addDays(day, count - 1);
      startDay = day;
      dayCount = count;
      inspection = null;
      selectedId = null;
      hoveredId = null;
      void tick().then(() => activeView()?.revealDay(day));
      return true;
    } catch {
      tell('That date range is outside the supported calendar. Your view has not changed.', true);
      return false;
    }
  }
  function shift(offset: number, count = dayCount) {
    attempt(() => go(addDays(startDay, offset), count));
  }
  function jump(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    if (!input.checkValidity() || !input.value || !go(input.value)) {
      input.value = startDay;
      tell('Enter a valid date range within years 1-9999.', true);
    }
  }
  function closeInspector(key: string) {
    if (inspection?.key !== key) return;
    inspection = null;
    selectedId = null;
    hoveredId = null;
    relationPreview = null;
    clearChecksContext();
    inspectorExpanded = false;
    recipeSelectedId = null;
  }
  function retainsRelationshipContext(target?: EventTarget | null) {
    return (
      calendar?.hasOutsideRelationships() &&
      target instanceof Element &&
      !!target.closest('.calendar-shell')
    );
  }
  function hover(id: string | null, event: PointerEvent) {
    if (id === null && retainsRelationshipContext(event.target)) return;
    if (
      !event.isTrusted ||
      (event.pointerType !== 'mouse' && event.pointerType !== 'pen') ||
      event.buttons !== 0 ||
      document.body.classList.contains('is-dragging')
    )
      return;
    if (hoveredId !== id) hoveredId = id;
  }
  function leaveHover(id: string, event: PointerEvent) {
    if (hoveredId === id) hover(null, event);
  }
  function outsidePointer(event: PointerEvent) {
    if (inspection || (!selectedId && !hoveredId) || event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(
        '[data-activity-id], [data-food-id], [data-blocker-id], .placement-banner, .relationship-strip'
      )
    )
      return;
    selectedId = null;
    hoveredId = null;
  }
  function outsideHover(event: PointerEvent) {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest('[data-activity-id], [data-food-id], .relationship-strip')
    )
      hover(null, event);
  }
  function cancelPlacement() {
    assignment = null;
    mode = 'activity';
    mealSourceId = null;
    relationPreview = null;
  }
  function flushEditor() {
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest('[role="dialog"]')
    )
      document.activeElement.blur();
  }
  function inspect(
    kind: 'activity' | 'block' | 'ingredient' | 'batch',
    id: string,
    element?: HTMLElement | null
  ) {
    flushEditor();
    relationPreview = null;
    selectedId = id;
    hoveredId = null;
    if (kind === 'activity') {
      if (mode === 'meal' && mealSourceId) {
        if (assignFood('batch', mealSourceId, id, mealAmount(mealSourceId))) cancelPlacement();
        return;
      }
      lastActivityId = id;
    }
    inspection = { key: `${kind}-${id}`, kind, id, anchor: element };
  }
  function chooseOnCalendar(kind: 'ingredient' | 'batch', id: string, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    flushEditor();
    cancelPlacement();
    const food = (kind === 'ingredient' ? plan.ingredients : plan.batches).find(
      (item) => item.id === id
    );
    if (!food) return;
    assignment = { kind, id, amount, name: food.name };
    void setView('calendar');
    inspection = null;
    selectedId = id;
    hoveredId = null;
  }
  function activateActivity(id: string, element: HTMLElement) {
    if (assignment) {
      const pending = assignment;
      if (assignFood(pending.kind, pending.id, id, pending.amount)) cancelPlacement();
      return;
    }
    inspect('activity', id, element);
  }
  let navigationVersion = 0;
  async function navigateEntity(target: EntityRef, at?: LocalTime, reveal?: CheckAction['reveal']) {
    // Commit the old field before replacing its keyed inspector. Navigation never assigns food.
    flushEditor();
    if (entityRef(plan, target.id)?.kind !== target.kind) return;
    const activity = plan.activities.find(
      (item) => target.kind === 'activity' && item.id === target.id
    );
    const blocker = plan.blockers.find((item) => target.kind === 'block' && item.id === target.id);
    const batch = plan.batches.find((item) => target.kind === 'batch' && item.id === target.id);
    const time =
      at ?? activity?.start ?? blocker?.start ?? (batch ? batchReadyAt(plan, batch) : undefined);
    if (time) {
      const timedEntity =
        activity ??
        blocker ??
        (batch?.source.kind === 'activity'
          ? plan.activities.find(
              (item) => batch.source.kind === 'activity' && item.id === batch.source.activityId
            )
          : undefined);
      const day = timedEntity
        ? (endpointSegmentDay(
            timedEntity.start,
            'elapsedMinutes' in timedEntity
              ? timedEntity.elapsedMinutes
              : timedEntity.durationMinutes,
            time,
            time.minute === 0 && timedEntity.start.day < time.day
              ? [time.day, addMinutes(time, -1).day]
              : [time.day]
          ) ?? time.day)
        : time.day;
      startDay = rangeForTarget(startDay, dayCount, day);
    }
    const version = ++navigationVersion;
    selectedId = target.id;
    hoveredId = null;
    relationPreview = null;
    if (activity) lastActivityId = activity.id;
    const key = `${target.kind}-${target.id}`;
    inspection = { key, ...target, reveal };
    // The inspector changes the calendar width. Reveal the exact endpoint only
    // after its final layout and sticky relationship surface have mounted.
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (version !== navigationVersion || inspection?.key !== key) return;
    let anchor: HTMLElement | undefined;
    if (activity) anchor = activeView()?.revealActivity(activity.id, time);
    else if (blocker) anchor = activeView()?.revealBlock(blocker.id, time);
    else if (batch?.source.kind === 'activity')
      anchor = activeView()?.revealActivity(batch.source.activityId, time);
    else
      anchor =
        document.querySelector<HTMLElement>(`[data-food-id="${CSS.escape(target.id)}"]`) ??
        undefined;
    inspection = { key, ...target, anchor, reveal };
  }
  function openBlank(
    start: LocalTime,
    element?: HTMLElement | null,
    duration?: number,
    editableStart = false
  ) {
    if (assignment) return;
    const length = duration ?? (mode === 'meal' ? 30 : 45);
    try {
      addMinutes(start, length);
    } catch {
      tell('Choose a time range within the supported calendar.', true);
      return;
    }
    if (mode === 'meal' && mealSourceId) {
      createMeal(mealSourceId, start, length);
      return;
    }
    selectedId = null;
    hoveredId = null;
    inspection = {
      key: newId('quick'),
      kind: 'quick',
      start,
      initialKind: 'cook',
      draftKind: 'cook',
      draftTitle: '',
      suppliedDuration: length,
      durationProvided: duration !== undefined,
      editableStart,
      previewDuration: length,
      previewValid: true,
      anchor: element
    };
  }
  function updateDraftStart(start: LocalTime) {
    if (inspection?.kind !== 'quick') return;
    inspection = { ...inspection, start };
    updateDraft(inspection.draftTitle, inspection.draftKind, inspection.previewDuration);
  }
  function revealCreated(id: string, start: LocalTime, kind: 'activity' | 'block' = 'activity') {
    startDay = rangeForTarget(startDay, dayCount, start.day);
    void tick().then(() => {
      if (kind === 'block') activeView()?.revealBlock(id);
      else activeView()?.revealActivity(id);
    });
  }
  function updateDraft(title: string, kind: QuickKind, duration: number) {
    if (inspection?.kind !== 'quick') return;
    let valid = true;
    try {
      addMinutes(inspection.start, duration);
    } catch {
      valid = false;
      if (inspection.previewValid || inspection.previewDuration !== duration)
        tell('Choose a time range within the supported calendar.', true);
    }
    if (
      inspection.draftTitle !== title ||
      inspection.draftKind !== kind ||
      inspection.previewDuration !== duration ||
      inspection.previewValid !== valid
    )
      inspection = {
        ...inspection,
        draftTitle: title,
        draftKind: kind,
        previewDuration: duration,
        previewValid: valid
      };
  }
  function createActivity(
    title: string,
    kind: QuickKind,
    start: LocalTime,
    duration = 45,
    chosen?: { id: string; yieldQuantity: number }
  ) {
    if (chosen) {
      attempt(() => {
        if (kind !== 'cook') throw new Error('Choose a cooking activity for this recipe.');
        const recipe = plan.recipes.find((item) => item.id === chosen.id);
        if (!recipe) throw new Error('This recipe is no longer available.');
        const { activity, batch, requirements } = instantiateRecipe(
          recipe,
          {
            activityId: newId('activity'),
            batchId: newId('batch'),
            start,
            title,
            durationMinutes: duration,
            yieldQuantity: chosen.yieldQuantity
          },
          () => newId('requirement')
        );
        // Reject spans past the calendar boundary before displaying a preview or saving.
        addMinutes(start, duration);
        if (
          !commit({
            ...plan,
            activities: [...plan.activities, activity],
            batches: [...plan.batches, batch],
            activityRequirements: [...plan.activityRequirements, ...requirements]
          })
        )
          return false;
        inspection = null;
        selectedId = activity.id;
        lastActivityId = activity.id;
        revealCreated(activity.id, start);
        return true;
      });
      return;
    }
    if (kind === 'block') {
      const blocker: Blocker = {
        id: newId('block'),
        title,
        start,
        durationMinutes: duration,
        away: false
      };
      if (commit({ ...plan, blockers: [...plan.blockers, blocker] })) {
        inspection = null;
        cancelPlacement();
        selectedId = blocker.id;
        revealCreated(blocker.id, start, 'block');
      }
      return;
    }
    const activity: Activity = {
      id: newId('activity'),
      title,
      kind: kind === 'cook' ? 'cook' : kind === 'meal' ? 'meal' : 'other',
      start,
      elapsedMinutes: duration,
      handsOnMinutes: 0,
      requiresHome: false,
      notes: ''
    };
    const batch: Batch = {
      id: newId('batch'),
      name: title,
      quantity: 4,
      unit: '',
      source: { kind: 'activity', activityId: activity.id }
    };
    if (
      commit({
        ...plan,
        activities: [...plan.activities, activity],
        batches: kind === 'cook' ? [...plan.batches, batch] : plan.batches
      })
    ) {
      inspection = null;
      selectedId = activity.id;
      lastActivityId = activity.id;
      revealCreated(activity.id, start);
    }
  }
  function openIssues(element?: HTMLElement) {
    if (!persistence.loaded || persistence.phase === 'loading' || inspection?.kind === 'issues')
      return;
    flushEditor();
    selectedId = null;
    hoveredId = null;
    relationPreview = null;
    if (checksSession.originKey) checksSession.returning = true;
    inspection = {
      key: 'issues',
      kind: 'issues',
      anchor:
        element ??
        document.querySelector<HTMLElement>(
          '.heading-actions [data-inspector-destination="issues"]'
        )
    };
  }
  function openRecipes(element?: HTMLElement) {
    if (!persistence.loaded || persistence.phase === 'loading' || inspection?.kind === 'recipes')
      return;
    flushEditor();
    selectedId = null;
    hoveredId = null;
    relationPreview = null;
    clearChecksContext();
    inspection = {
      key: 'recipes',
      kind: 'recipes',
      anchor:
        element ??
        document.querySelector<HTMLElement>(
          '.heading-actions [data-inspector-destination="recipes"]'
        )
    };
  }
  function addRecipe(name: string): string | null {
    const recipe = createRecipe(newId('recipe'), name);
    return commit({ ...plan, recipes: [...plan.recipes, recipe] }) ? recipe.id : null;
  }
  function patchRecipe(id: string, patch: Partial<Recipe>): boolean {
    if (patch.name !== undefined && !patch.name.trim()) {
      tell('Give the recipe a name.', true);
      return false;
    }
    return commit({
      ...plan,
      recipes: plan.recipes.map((recipe) => (recipe.id === id ? { ...recipe, ...patch } : recipe))
    });
  }
  function addRecipeIngredient(recipeId: string, text: string): boolean {
    return attempt(() => {
      const { name, quantity: amount } = parseIngredient(text);
      const recipe = plan.recipes.find((item) => item.id === recipeId);
      if (!recipe) return false;
      const ingredient: RecipeIngredient = {
        id: newId('recipe-ingredient'),
        name,
        quantity: amount
      };
      return patchRecipe(recipeId, { ingredients: [...recipe.ingredients, ingredient] });
    });
  }
  function patchRecipeIngredient(
    recipeId: string,
    id: string,
    patch: Partial<RecipeIngredient>
  ): boolean {
    const recipe = plan.recipes.find((item) => item.id === recipeId);
    if (!recipe) return false;
    return patchRecipe(recipeId, {
      ingredients: recipe.ingredients.map((item) => (item.id === id ? { ...item, ...patch } : item))
    });
  }
  function removeRecipeIngredient(recipeId: string, id: string) {
    const recipe = plan.recipes.find((item) => item.id === recipeId);
    if (recipe)
      patchRecipe(recipeId, { ingredients: recipe.ingredients.filter((item) => item.id !== id) });
  }
  function deleteRecipe(id: string): boolean {
    return commit(
      { ...plan, recipes: plan.recipes.filter((recipe) => recipe.id !== id) },
      'Recipe removed. Planned activities stay as they are.'
    );
  }
  function patchRequirement(id: string, patch: Partial<ActivityRequirement>): boolean {
    return commit({
      ...plan,
      activityRequirements: plan.activityRequirements.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      )
    });
  }
  function addRequirement(activityId: string, text: string): boolean {
    return attempt(() => {
      const { name, quantity: amount } = parseIngredient(text);
      return commit({
        ...plan,
        activityRequirements: [
          ...plan.activityRequirements,
          {
            id: newId('requirement'),
            activityId,
            name,
            quantity: amount
          }
        ]
      });
    });
  }
  function removeRequirement(id: string) {
    commit({
      ...plan,
      activityRequirements: plan.activityRequirements.filter((item) => item.id !== id)
    });
  }
  function patchActivity(id: string, patch: Partial<Activity>): boolean {
    const activity = plan.activities.find((item) => item.id === id);
    if (!activity) return false;
    if (patch.title !== undefined && !patch.title.trim()) {
      tell('Give the activity a name.', true);
      return false;
    }
    const next = { ...activity, ...patch };
    return commit({
      ...plan,
      activities: plan.activities.map((a) => (a.id === id ? next : a)),
      batches: patch.title
        ? plan.batches.map((batch) =>
            batch.source.kind === 'activity' &&
            batch.source.activityId === id &&
            batch.name === activity.title
              ? { ...batch, name: patch.title! }
              : batch
          )
        : plan.batches
    });
  }
  function patchBlocker(id: string, patch: Partial<Blocker>) {
    if (patch.title !== undefined && !patch.title) return false;
    return commit({
      ...plan,
      blockers: plan.blockers.map((item) => (item.id === id ? { ...item, ...patch } : item))
    });
  }
  function patchBatch(id: string, patch: Partial<Batch>): boolean {
    if (patch.name !== undefined && !patch.name.trim()) {
      tell('Food needs a name.', true);
      return false;
    }
    return commit({
      ...plan,
      batches: plan.batches.map((batch) => (batch.id === id ? { ...batch, ...patch } : batch))
    });
  }
  function patchFood(
    kind: 'ingredient' | 'batch',
    id: string,
    patch: { name?: string; quantity?: number }
  ) {
    return kind === 'batch'
      ? patchBatch(id, patch)
      : commit({
          ...plan,
          ingredients: plan.ingredients.map((item) =>
            item.id === id ? { ...item, ...patch } : item
          )
        });
  }
  function addFood(kind: 'ingredient' | 'batch', text: string): boolean {
    return attempt(() => {
      if (kind === 'ingredient') {
        const ingredient = { ...parseIngredient(text), id: newId('ingredient') };
        return commit(
          { ...plan, ingredients: [...plan.ingredients, ingredient] },
          `${ingredient.name} added to ingredients to use.`
        );
      }
      const batch: Batch = {
        ...parsePreparedFood(text),
        id: newId('stock'),
        source: { kind: 'existing', availableAt: { day: startDay, minute: 0 } }
      };
      return commit(
        { ...plan, batches: [...plan.batches, batch] },
        `${batch.name} added as already cooked food.`
      );
    });
  }
  function patchRawUse(id: string, amount: number) {
    return attempt(() => commit(patchIngredientUseAmount(plan, id, amount)));
  }
  function assignFood(
    kind: 'ingredient' | 'batch',
    id: string,
    activityId: string,
    amount: number
  ): boolean {
    if (!Number.isFinite(amount) || amount <= 0) {
      tell('Nothing left unplanned. Adjust an existing allocation first.', true);
      return false;
    }
    const applied =
      kind === 'ingredient'
        ? attempt(() =>
            commit(addIngredientAssignment(plan, id, activityId, amount, () => newId('use')))
          )
        : attempt(() =>
            commit(addBatchAssignment(plan, id, activityId, amount, () => newId('allocation')))
          );
    if (applied) {
      selectedId = id;
      tell(
        `Assigned ${quantity(amount)} ${(kind === 'ingredient' ? plan.ingredients : plan.batches).find((item) => item.id === id)?.name} to ${plan.activities.find((a) => a.id === activityId)?.title}.`
      );
    }
    return applied;
  }
  function patchAllocation(id: string, amount: number) {
    return attempt(() => commit(patchAllocationAmount(plan, id, amount)));
  }
  function startMeal(batchId: string) {
    cancelPlacement();
    mode = 'meal';
    mealSourceId = batchId;
    void setView('calendar');
    inspection = null;
    selectedId = null;
    hoveredId = null;
  }
  function mealAmount(batchId: string) {
    const remaining = batchTotals(plan, batchId).remaining;
    return remaining > 0 ? Math.min(2, remaining) : 2;
  }
  function createMeal(batchId: string, start: LocalTime, duration = 30) {
    const batch = plan.batches.find((item) => item.id === batchId);
    if (!batch) return;
    const amount = mealAmount(batchId),
      id = newId('meal');
    const activity: Activity = {
      id,
      title: `${batch.name} meal`,
      kind: 'meal',
      start,
      elapsedMinutes: duration,
      handsOnMinutes: 0,
      requiresHome: false,
      notes: ''
    };
    if (
      commit({
        ...plan,
        activities: [...plan.activities, activity],
        allocations: [
          ...plan.allocations,
          {
            id: newId('allocation'),
            batchId,
            activityId: id,
            quantity: amount,
            purpose: 'eat',
            when: 'start'
          }
        ]
      })
    ) {
      cancelPlacement();
      inspection = null;
      selectedId = id;
      lastActivityId = id;
      tick().then(() => calendar?.revealActivity(id));
    }
  }
  function addOutput(activityId: string) {
    commit({
      ...plan,
      batches: [
        ...plan.batches,
        {
          id: newId('batch'),
          name: 'Extra food',
          quantity: 2,
          unit: '',
          source: { kind: 'activity', activityId }
        }
      ]
    });
  }
  function removeOutput(id: string) {
    commit({ ...plan, ...removeBatch(plan, id) }, 'Food output and its allocations removed.');
  }
  function remove(kind: 'activity' | 'block' | 'ingredient' | 'batch', id: string) {
    const next =
      kind === 'activity'
        ? deleteActivity(plan, id)
        : kind === 'block'
          ? deleteBlocker(plan, id)
          : kind === 'ingredient'
            ? deleteIngredient(plan, id)
            : { ...plan, ...removeBatch(plan, id) };
    inspection = null;
    selectedId = null;
    hoveredId = null;
    commit(next, 'Removed from the plan.');
  }

  function hitCalendar(point: DragPoint, boundary = false): LocalTime | null {
    const area = document.querySelector<HTMLElement>('.calendar-scroll');
    if (!area) return null;
    const bounds = area.getBoundingClientRect();
    if (
      point.x < bounds.left + 52 ||
      point.x > bounds.right ||
      point.y < bounds.top + 54 ||
      point.y > bounds.bottom
    )
      return null;
    const column = document
      .elementFromPoint(point.x, point.y)
      ?.closest<HTMLElement>('[data-time-day]');
    if (!column?.dataset.timeDay) return null;
    try {
      const minute = snapMinute(
        (point.y - column.getBoundingClientRect().top) / PX_PER_MINUTE,
        boundary
      );
      return addMinutes({ day: column.dataset.timeDay, minute: 0 }, minute);
    } catch {
      return null;
    }
  }
  function autoScroll(point: DragPoint) {
    const area = document.querySelector<HTMLElement>('.calendar-scroll');
    if (!area) return;
    const bounds = area.getBoundingClientRect();
    if (
      point.x < bounds.left ||
      point.x > bounds.right ||
      point.y < bounds.top ||
      point.y > bounds.bottom
    )
      return;
    const dx = point.x > bounds.right - 30 ? 9 : point.x < bounds.left + 72 ? -9 : 0;
    const dy = point.y > bounds.bottom - 16 ? 9 : point.y < bounds.top + 70 ? -9 : 0;
    if (dx || dy) {
      area.scrollLeft += dx;
      area.scrollTop += dy;
    }
  }
  function clearDrag() {
    preview = null;
    dropTargetId = null;
    dragBubble = null;
  }
  function showDrag(point: DragPoint, title: string, detail: string) {
    inspection = null;
    hoveredId = null;
    if (
      !dragBubble ||
      dragBubble.x !== point.x ||
      dragBubble.y !== point.y ||
      dragBubble.detail !== detail
    )
      dragBubble = { ...point, title, detail };
  }
  function acceptsDrag(event: PointerEvent) {
    return (
      event.button === 0 &&
      (event.pointerType !== 'touch' ||
        (event.target as HTMLElement).closest('[data-drag-handle],.resize-handle') !== null)
    );
  }
  function timeDrag(
    event: PointerEvent,
    id: string,
    kind: 'activity' | 'block',
    edge?: ResizeEdge
  ) {
    if (assignment || !acceptsDrag(event)) return;
    const item =
      kind === 'activity'
        ? plan.activities.find((a) => a.id === id)
        : plan.blockers.find((b) => b.id === id);
    if (!item) return;
    const duration = 'elapsedMinutes' in item ? item.elapsedMinutes : item.durationMinutes;
    const initial = hitCalendar({ x: event.clientX, y: event.clientY });
    const offset = initial ? absoluteMinute(initial) - absoluteMinute(item.start) : 0;
    cancelGesture?.();
    const destination = (point: DragPoint) => {
      const hit = hitCalendar(point, !!edge);
      if (!hit) return null;
      try {
        if (edge) return resizeSpan(item.start, duration, edge, hit);
        const start = addMinutes(hit, -offset);
        addMinutes(start, duration);
        return { start, duration };
      } catch {
        return null;
      }
    };
    cancelGesture = pointerDrag(event, {
      move: (point) => {
        autoScroll(point);
        const next = destination(point);
        preview = next ? { id, kind, ...next, label: item.title } : null;
        showDrag(
          point,
          item.title,
          next
            ? `${formatTime(next.start.minute)} / ${next.duration} minutes`
            : 'Drop onto the calendar'
        );
      },
      drop: (point) => {
        const next = destination(point);
        clearDrag();
        if (!next) return;
        const applied = attempt(() =>
          kind === 'activity'
            ? patchActivity(id, { start: next.start, elapsedMinutes: next.duration })
            : commit(moveBlocker(plan, id, next.start, next.duration))
        );
        if (applied) {
          selectedId = id;
          if (kind === 'activity') lastActivityId = id;
        }
      },
      cancel: clearDrag
    });
  }
  function foodDrag(event: PointerEvent, kind: 'ingredient' | 'batch', id: string) {
    if (!acceptsDrag(event)) return;
    const food = (kind === 'ingredient' ? plan.ingredients : plan.batches).find(
      (item) => item.id === id
    );
    if (!food) return;
    const amount =
      kind === 'ingredient'
        ? ingredientTotals(plan, id).remaining
        : Math.min(2, batchTotals(plan, id).remaining);
    const target = (point: DragPoint) =>
      document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-activity-id]')
        ?.dataset.activityId ?? null;
    let edgeSince: number | null = null;
    cancelGesture?.();
    cancelGesture = pointerDrag(event, {
      move: (point) => {
        const bounds = document.querySelector('.calendar-scroll')?.getBoundingClientRect();
        const nearEdge =
          bounds &&
          point.x >= bounds.left &&
          point.x <= bounds.right &&
          point.y >= bounds.top &&
          point.y <= bounds.bottom &&
          (point.x < bounds.left + 72 ||
            point.x > bounds.right - 30 ||
            point.y < bounds.top + 70 ||
            point.y > bounds.bottom - 16);
        // Pause at the calendar edge before scrolling past an intended drop target.
        if (!target(point) && nearEdge) {
          edgeSince ??= performance.now();
          if (performance.now() - edgeSince > 300) autoScroll(point);
        } else edgeSince = null;
        dropTargetId = target(point);
        showDrag(
          point,
          `${quantity(amount)} ${food.name}`,
          dropTargetId
            ? `Use in ${plan.activities.find((a) => a.id === dropTargetId)?.title}`
            : kind === 'ingredient'
              ? 'Drop onto a cooking or eating card'
              : 'Drop onto a meal, or an empty time'
        );
      },
      drop: (point) => {
        const activityId = target(point),
          start = hitCalendar(point);
        clearDrag();
        if (activityId) {
          assignFood(kind, id, activityId, amount);
        } else if (kind === 'batch' && start && amount > 0) {
          createMeal(id, start);
        } else
          tell(
            'Drop ingredients onto an activity card, or tap the ingredient to choose one.',
            true
          );
      },
      cancel: clearDrag
    });
  }
  function rangeDrag(event: PointerEvent) {
    // Touch keeps native grid scrolling; tapping creates and edge grips resize.
    if (assignment || event.button !== 0 || event.pointerType === 'touch') return;
    const start = hitCalendar({ x: event.clientX, y: event.clientY });
    if (!start) return;
    const anchor = event.currentTarget as HTMLElement;
    const range = (point: DragPoint) => {
      const end = hitCalendar(point, true);
      if (!end) return null;
      const first = absoluteMinute(start) <= absoluteMinute(end) ? start : end;
      const duration = Math.max(15, Math.abs(absoluteMinute(end) - absoluteMinute(start)));
      try {
        if (duration > MAX_ACTIVITY_MINUTES) return null;
        addMinutes(first, duration);
      } catch {
        return null;
      }
      return { start: first, duration };
    };
    cancelGesture?.();
    cancelGesture = pointerDrag(event, {
      move: (point) => {
        autoScroll(point);
        const next = range(point);
        preview = next
          ? { kind: 'activity', ...next, label: mealSource?.name ?? 'New activity' }
          : null;
        showDrag(
          point,
          'Plan this time',
          next
            ? `${formatTime(next.start.minute)} / ${next.duration} minutes`
            : 'Drop onto the calendar'
        );
      },
      drop: (point) => {
        const next = range(point);
        clearDrag();
        if (!next) return;
        const target =
          document.querySelector<HTMLElement>(
            `[data-time-day="${next.start.day}"] .empty-calendar`
          ) ?? anchor;
        openBlank(next.start, target, next.duration);
      },
      cancel: clearDrag
    });
  }
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (persistence.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  function downloadChanges() {
    const content = sync?.recoveryFile();
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'meal-prep-recovery.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function reloadSaved() {
    if (
      !window.confirm(
        "Replace this tab's local changes with the saved server plan? Download a copy first if you need to keep them."
      )
    )
      return;
    inspection = null;
    selectedId = null;
    hoveredId = null;
    cancelPlacement();
    cancelGesture?.();
    await sync?.reloadSaved();
    if (sync?.state.phase === 'conflict' || sync?.state.phase === 'recovery-error')
      tell('Could not load the saved plan. The local copy has been kept.', true);
  }
  function shortcut(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      cancelPlacement();
      inspection = null;
      selectedId = null;
      hoveredId = null;
    }
    const element = event.target as HTMLElement;
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'z' &&
      !element.closest('input,textarea,select,[contenteditable="true"]')
    ) {
      event.preventDefault();
      undo();
    }
  }
</script>

<svelte:document
  onkeydowncapture={(event) => {
    if (event.key === 'Escape') cancelPlacement();
  }}
/>
<svelte:window
  onkeydown={shortcut}
  onpointerdown={outsidePointer}
  onpointermove={outsideHover}
  onpointerleave={(event) => hover(null, event)}
  onbeforeunload={warnBeforeUnload}
  ononline={() => {
    if (persistence.phase === 'error') void sync?.retry();
  }}
/>
<svelte:head
  ><title>Meal prep - Your plan</title><meta
    name="description"
    content="Plan cooking and meals on a flexible timeline. Give ingredients a use, follow portions, and make room for your week."
  /></svelte:head
>

<header class="app-header">
  <div class="brand"><span class="brand-mark"><Icon name="bowl" size={23} /></span>meal prep.</div>
  <div class="header-right">
    <span>Our kitchen / 2 people</span>
    <ThemeToggle /><span
      class="save-status"
      class:unsaved={persistence.dirty ||
        persistence.phase === 'error' ||
        persistence.phase === 'recovery-error'}
      role="status"
      data-testid="save-status"
      data-state={persistence.phase}
      >{persistence.phase === 'saved'
        ? 'Saved'
        : persistence.phase === 'loading'
          ? 'Loading...'
          : persistence.phase === 'saving'
            ? 'Saving...'
            : 'Not saved'}</span
    >
  </div>
</header>
<main class="main">
  {#if saveProblem}<div class="save-problem" role="alert">
      <p>{saveProblem}</p>
      <div>
        {#if persistence.phase === 'error'}<button
            class="secondary-button"
            onclick={() => void sync?.retry()}>Retry</button
          >{/if}
        {#if persistence.dirty || persistence.phase === 'recovery-error'}<button
            class="secondary-button"
            onclick={downloadChanges}>Download local changes</button
          >{/if}
        {#if persistence.phase === 'conflict' || persistence.phase === 'recovery-error'}<button
            class="secondary-button"
            onclick={reloadSaved}>Load saved plan</button
          >{/if}
      </div>
    </div>{/if}
  <div class="workspace-heading">
    <div class="heading-copy">
      <h1>Your plan</h1>
      <p>See your days. Give food a place.</p>
    </div>
    <div class="heading-actions">
      <button
        class="inspector-entry"
        data-inspector-destination="issues"
        aria-pressed={inspection?.kind === 'issues' || !!checksSession.originKey}
        disabled={!persistence.loaded || persistence.phase === 'loading'}
        onclick={(event) => openIssues(event.currentTarget)}
        >Checks <span class:has-checks={warnings.length > 0}>{warnings.length || 'All clear'}</span
        ></button
      >
      <button
        class="inspector-entry"
        data-inspector-destination="recipes"
        aria-pressed={inspection?.kind === 'recipes'}
        disabled={!persistence.loaded || persistence.phase === 'loading'}
        onclick={(event) => openRecipes(event.currentTarget)}
        ><Icon name="book" size={14} /> Recipes</button
      >
      <button
        class="text-button"
        onclick={undo}
        disabled={!history.length}
        aria-label="Undo last change"><Icon name="reset" size={14} /> Undo</button
      >
    </div>
  </div>
  {#if persistence.loaded}
    <div
      class="workspace"
      class:has-inspector={inspection && inspection.kind !== 'quick'}
      inert={persistence.phase === 'loading'}
    >
      <div class="stock-access">
        <FoodTray
          {plan}
          {selectedId}
          {related}
          onhover={hover}
          onleave={leaveHover}
          onkeyboard={keyboardPreview}
          onadd={addFood}
          onselect={inspect}
          ondrag={foodDrag}
        />
      </div>
      <section
        class="calendar-shell"
        aria-label="Your food plan"
        onfocusout={(event) => {
          if (
            !inspection &&
            !(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
          )
            hoveredId = null;
        }}
      >
        <div class="calendar-toolbar">
          <div class="date-navigation">
            <button class="icon-button" aria-label="Previous days" onclick={() => shift(-dayCount)}
              ><Icon name="left" size={17} /></button
            ><button class="icon-button" aria-label="Next days" onclick={() => shift(dayCount)}
              ><Icon name="right" size={17} /></button
            >
            <h2>{rangeTitle}<span class="year">{startDay.slice(0, 4)}</span></h2>
          </div>
          <div class="calendar-controls">
            <div class="view-switch" role="group" aria-label="Plan view">
              <button aria-pressed={view === 'calendar'} onclick={() => setView('calendar')}
                >Calendar</button
              >
              <button aria-pressed={view === 'agenda'} onclick={() => setView('agenda')}
                >Agenda</button
              >
            </div>
            <button
              class="secondary-button"
              onclick={() => {
                go(startOfWeek(todayDay()), 7);
                void tick().then(() => activeView()?.revealDay(todayDay()));
              }}>This week</button
            ><input
              class="jump-date"
              type="date"
              aria-label="Jump to date"
              min="0001-01-01"
              max="9999-12-31"
              value={startDay}
              onchange={jump}
            />
          </div>
        </div>
        {#if assignment}<div class="placement-banner">
            <span>Choose an activity for {quantity(assignment.amount)} {assignment.name}.</span
            ><button class="secondary-button" onclick={cancelPlacement}>Cancel</button>
          </div>{/if}
        {#if mode === 'meal'}<div class="placement-banner">
            <span
              ><Icon name="bowl" size={15} />{view === 'calendar'
                ? 'Click or drag a time'
                : 'Choose an activity or plan on calendar'} to use {mealSource?.name ??
                'this food'}.</span
            ><button
              class="icon-button tiny"
              aria-label="Cancel placement"
              onclick={() => {
                cancelPlacement();
                selectedId = null;
                hoveredId = null;
              }}><Icon name="close" size={14} /></button
            >
          </div>{/if}
        {#if view === 'agenda'}
          <Agenda
            bind:this={agenda}
            {plan}
            {days}
            {selectedId}
            {related}
            {warnings}
            onselect={activateActivity}
            onblock={(id, element) => inspect('block', id, element)}
            onplan={planOnCalendar}
            onadd={(day, element) => openBlank({ day, minute: 720 }, element, undefined, true)}
            onhover={hover}
            onleave={leaveHover}
            onkeyboard={keyboardPreview}
          />
        {:else}
          <Timeline
            bind:this={calendar}
            {plan}
            {days}
            {selectedId}
            {related}
            focusedAllocationIds={focus.allocationIds}
            {warnings}
            {mode}
            preview={shownPreview}
            {dropTargetId}
            onhover={hover}
            onleave={leaveHover}
            onkeyboard={keyboardPreview}
            onselect={activateActivity}
            onblock={(id, element) => inspect('block', id, element)}
            onblank={openBlank}
            onactivitydrag={(event, id, edge) => timeDrag(event, id, 'activity', edge)}
            onblockdrag={(event, id, edge) => timeDrag(event, id, 'block', edge)}
            onrangedrag={rangeDrag}
            onnavigate={navigateEntity}
          />
        {/if}
        <div class="calendar-footer">
          <button class="text-button" onclick={() => shift(-1, dayCount + 1)}
            ><Icon name="left" size={12} /> Earlier day</button
          ><span class="relationship-context" aria-live="polite">{focusLabel}</span>
          <div class="day-range-actions">
            <button
              class="text-button"
              title="Hide the last visible day without removing anything from your plan"
              disabled={dayCount <= 1}
              onclick={() => go(startDay, dayCount - 1)}>One fewer day</button
            >
            <button class="text-button" onclick={() => go(startDay, dayCount + 1)}
              >One more day <Icon name="plus" size={12} /></button
            >
          </div>
        </div>
      </section>
    </div>
    <footer class="app-footer">
      <div class="legend">
        <span><i class="status-dot"></i>Cooking</span><span
          ><i class="status-dot warm"></i>Eating</span
        ><span>Hatched areas = blocked time</span>
      </div>
      <span>One shared plan. Saved on your server.</span>
    </footer>
  {:else if persistence.phase === 'loading'}<p class="loading-plan" role="status">
      Loading your plan...
    </p>{/if}
</main>

{#if inspection}
  {#key inspection.key}
    {@const opened = inspection}
    {#if opened.kind === 'quick'}<QuickCreate
        start={opened.start}
        initialKind={opened.initialKind}
        duration={opened.suppliedDuration}
        durationProvided={opened.durationProvided}
        editableStart={opened.editableStart}
        onstartchange={updateDraftStart}
        recipes={plan.recipes}
        anchor={opened.anchor}
        oncreate={(title, kind, duration, recipe) =>
          createActivity(
            title,
            kind,
            inspection?.kind === 'quick' ? inspection.start : opened.start,
            duration,
            recipe
          )}
        onpreview={updateDraft}
        onclose={() => closeInspector(opened.key)}
      />
    {:else if opened.kind === 'issues'}
      <IssuesPopover
        {plan}
        {warnings}
        bind:session={checksSession}
        anchor={opened.anchor}
        onnavigate={navigateCheck}
        onclose={() => closeInspector(opened.key)}
      />
    {:else if opened.kind === 'recipes'}
      <RecipesPopover
        recipes={plan.recipes}
        bind:selectedId={recipeSelectedId}
        bind:newName={recipeNewName}
        anchor={opened.anchor}
        oncreate={addRecipe}
        onpatch={patchRecipe}
        onadd={addRecipeIngredient}
        oningredient={patchRecipeIngredient}
        onremoveingredient={removeRecipeIngredient}
        ondelete={deleteRecipe}
        onclose={() => closeInspector(opened.key)}
      />
    {:else if opened.kind === 'activity'}
      {@const activity = plan.activities.find((item) => item.id === opened.id)}
      {#if activity}<ActivityPopover
          {plan}
          {activity}
          {warnings}
          reveal={opened.reveal === 'schedule' ? opened.reveal : undefined}
          anchor={opened.anchor}
          onpatch={(patch) => patchActivity(activity.id, patch)}
          onbatch={patchBatch}
          onallocation={patchAllocation}
          oningredient={patchRawUse}
          onassign={(kind, id, amount) => {
            const applied = assignFood(kind, id, activity.id, amount);
            if (applied) selectedId = activity.id;
            return applied;
          }}
          requirements={plan.activityRequirements.filter((item) => item.activityId === activity.id)}
          onrequirement={patchRequirement}
          onaddrequirement={(text) => addRequirement(activity.id, text)}
          onremoverequirement={removeRequirement}
          onplanmeal={startMeal}
          oneathere={(id) => assignFood('batch', id, activity.id, 2)}
          onaddbatch={() => addOutput(activity.id)}
          onremovebatch={removeOutput}
          onnavigate={navigateEntity}
          onpreview={relationHandler(opened.key)}
          ondelete={() => remove('activity', activity.id)}
          onclose={() => closeInspector(opened.key)}
        />{/if}
    {:else if opened.kind === 'block'}
      {@const blocker = plan.blockers.find((item) => item.id === opened.id)}
      {#if blocker}<BlockPopover
          {blocker}
          reveal={opened.reveal === 'schedule' ? opened.reveal : undefined}
          anchor={opened.anchor}
          onpatch={(patch) => patchBlocker(blocker.id, patch)}
          ondelete={() => remove('block', blocker.id)}
          onclose={() => closeInspector(opened.key)}
        />{/if}
    {:else}
      {@const kind = opened.kind}
      <FoodPopover
        {plan}
        {kind}
        id={opened.id}
        reveal={opened.reveal === 'availability' ? opened.reveal : undefined}
        anchor={opened.anchor}
        lastActivityId={plan.activities.some((item) => item.id === lastActivityId)
          ? lastActivityId
          : null}
        onpatch={(patch) => patchFood(kind, opened.id, patch)}
        onassign={(activityId, amount) => assignFood(kind, opened.id, activityId, amount)}
        onchoosecalendar={(amount) => chooseOnCalendar(kind, opened.id, amount)}
        onsetuse={patchRawUse}
        onallocation={patchAllocation}
        onready={(time) =>
          patchBatch(opened.id, { source: { kind: 'existing', availableAt: time } })}
        onplanmeal={() => startMeal(opened.id)}
        onnavigate={navigateEntity}
        onpreview={relationHandler(opened.key)}
        ondelete={() => remove(kind, opened.id)}
        onclose={() => closeInspector(opened.key)}
      />
    {/if}
  {/key}
{/if}
{#if dragBubble}<div
    class="drag-bubble"
    style:left={`${Math.max(8, Math.min(window.innerWidth - 280, dragBubble.x + 15))}px`}
    style:top={`${Math.min(window.innerHeight - 70, dragBubble.y + 18)}px`}
    aria-hidden="true"
  >
    {dragBubble.title}<small>{dragBubble.detail}</small>
  </div>{/if}
{#if notice}<div class="notice" class:error={notice.error} role={notice.error ? 'alert' : 'status'}>
    <span>{notice.text}</span><button
      class="icon-button"
      aria-label="Dismiss message"
      onclick={() => (notice = null)}><Icon name="close" size={14} /></button
    >
  </div>{/if}
