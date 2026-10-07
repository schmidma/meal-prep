<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import {
    emptyCatalog,
    catalogRecipes,
    planningCatalog,
    retainPlannedRecipes,
    snapshotId,
    type BookRecipe,
    type RecipeCatalog
  } from '$lib/recipe-books';
  import { bookRequest, BookRequestError } from '$lib/recipe-books-client';
  import RecipeBookManager from '$lib/components/RecipeBookManager.svelte';
  import ShoppingList from '$lib/components/ShoppingList.svelte';
  import NumberInput from '$lib/components/NumberInput.svelte';
  import { confirmAction, askChoice } from '$lib/confirmation';
  import { setAccountContext, accountFetch } from '$lib/household-client';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { Account } from '$lib/account';
  import HouseholdSettings from '$lib/components/HouseholdSettings.svelte';
  import SignOut from '$lib/components/SignOut.svelte';
  import { onMount, tick } from 'svelte';
  import { touchDrag } from '$lib/touch-drag';
  import { autoGrow } from '$lib/auto-grow';
  import { addDays, parseDay, startOfWeek, todayDay } from '$lib/calendar';
  import { PlanSync, httpPlanTransport, type SyncState } from '$lib/plan-sync';
  import {
    deleteActivity,
    type KitchenPlan,
    type MealStyle,
    type Recipe,
    type CookingSession
  } from '$lib/kitchen';
  import type { Activity, Batch } from '$lib/domain';
  import {
    emptyKitchen,
    extras,
    mealSlot,
    mealStyle,
    minuteForSlot,
    type MealSlot
  } from '$lib/planner';
  import { parseKitchenPlan } from '$lib/plan-document';
  import { newId } from '$lib/id';
  import PlanningSettingsPanel from '$lib/components/PlanningSettings.svelte';
  import {
    planningSettings,
    planningStart,
    visibleSections,
    validateSettings,
    type PlanningSettings
  } from '$lib/planning-settings';
  import CookingEditor from '$lib/components/CookingEditor.svelte';
  import RecipeInput from '$lib/components/RecipeInput.svelte';
  import { recipeMatches } from '$lib/use-soon';
  import { servingSlots, removeCooking } from '$lib/cooking';
  import { photoUrl } from '$lib/food-photos';
  import PhotoPicker from '$lib/components/PhotoPicker.svelte';
  import FoodDialogHeader from '$lib/components/FoodDialogHeader.svelte';
  import IngredientInput from '$lib/components/IngredientInput.svelte';
  import RecipeIngredients from '$lib/components/RecipeIngredients.svelte';
  import IngredientLibrary from '$lib/components/IngredientLibrary.svelte';
  import {
    linkIngredients,
    ingredientLine,
    recipeIngredientSearch,
    recipeHasIngredients,
    findIngredient,
    ingredientKey,
    parseRecipeIngredientLine
  } from '$lib/ingredient-library';
  import Icon from '$lib/components/Icon.svelte';
  import '$lib/styles/planner.css';

  let account = $state<Account | null>(null);
  let catalog = $state<RecipeCatalog>(emptyCatalog());
  let catalogReady = $state(false);
  let bookFilter = $state('');
  let bookManager = $state(false);
  let recipeBookId = $state('');
  let recipeSaving = $state(false);
  let recipeDraftId = $state('');
  let currentEntry = $state<BookRecipe | undefined>();
  let catalogRequest = 0;
  async function refreshBooks(canApply = () => true) {
    const request = ++catalogRequest;
    try {
      const value = await bookRequest();
      if (request !== catalogRequest || (catalogReady && !canApply())) return;
      catalog = value;
      catalogReady = true;
      if (bookFilter && !catalog.books.some((b) => b.id === bookFilter)) bookFilter = '';
    } catch (cause) {
      if (!catalogReady) throw cause;
    }
  }
  function bookForRecipe(id: string) {
    const entry = catalog.recipes.find((r) => snapshotId(r) === id);
    return catalog.books.find((b) => b.id === entry?.bookId);
  }
  let accountError = $state('');
  const storageScope = () =>
    account ? `${account.user.id}:${account.household!.id}` : 'uninitialized';
  let cooking = $state<{
    session?: CookingSession;
    recipe?: Recipe;
    day?: string;
    firstMeal?: MealSlot;
  } | null>(null);
  let photo = $state('');
  let sourceId = $state('');
  let leftoverId = $state('');
  let sourcePortions = $state(2);
  let plan = $state<KitchenPlan>(emptyKitchen());
  const preferredPortions = $derived(planningSettings(plan).portions);
  let persistence = $state<SyncState>({
    phase: 'loading',
    loaded: false,
    dirty: false,
    recoveryUnavailable: false
  });
  let sync: PlanSync;
  let week = $state(startOfWeek(todayDay()));
  let visibleDays = $state(7);
  let preparationExpanded = $state(false);
  let tab = $state<'week' | 'recipes' | 'shopping' | 'settings'>('week');
  async function navigateSection(next: typeof tab) {
    if (tab === next) return;
    tab = next;
    try {
      sessionStorage.setItem(`meal-prep:page:${storageScope()}`, next);
    } catch {}
    await tick();
    window.scrollTo(0, 0);
  }
  let modal = $state<'meal' | 'meal-choice' | 'recipe' | 'leftover' | null>(null);
  let dialog = $state<HTMLDialogElement>();
  let editing = $state('');
  let title = $state('');
  let date = $state(todayDay());
  let slot = $state<MealSlot>('Dinner');
  let style = $state<MealStyle>('cook');
  let notes = $state('');
  let portions = $state(2);
  let libraryOpen = $state(false);
  let photoBusy = $state(false);
  let photoOpen = $state(false);
  const bookNames = $derived(
    catalog.books.length > 1
      ? Object.fromEntries(
          catalog.recipes.map((r) => [
            snapshotId(r),
            catalog.books.find((b) => b.id === r.bookId)?.name ?? ''
          ])
        )
      : {}
  );
  const cookingPlan = $derived(linkIngredients(planningCatalog(plan, catalog)));
  const availableRecipes = $derived(catalogRecipes(catalog, cookingPlan));
  const recipeAccess = $derived(catalog.books.find((b) => b.id === recipeBookId)?.access);
  const recipeReadOnly = $derived(modal === 'recipe' && !!editing && recipeAccess === 'view');
  const writableBooks = $derived(catalog.books.filter((b) => b.access !== 'view'));
  let leftoverRecipeId = $state('');
  const boundRecipe = $derived(
    cookingPlan.recipes.find(
      (r) =>
        r.id ===
        (modal === 'leftover'
          ? leftoverRecipeId
          : modal === 'meal'
            ? (sessions.find((s) => s.id === sourceId)?.recipeId ??
              plan.batches.find((b) => b.id === leftoverId)?.recipeId)
            : undefined)
    )
  );
  const dialogPhoto = $derived(
    boundRecipe ? (cookingPlan.weekly?.images?.[boundRecipe.id] ?? '') : photo
  );
  let recipePaste = $state('');
  let recipeIngredients = $state<Recipe['ingredients']>([]);
  let mealIngredients = $state<Recipe['ingredients']>([]);
  let shopWithMeal = $state(false);
  let initialDraft = '';
  const draftKey = () =>
    JSON.stringify({
      title,
      date,
      slot,
      style,
      notes,
      portions,
      recipeIngredients,
      recipePaste,
      recipeBookId,
      leftoverRecipeId,
      shopWithMeal,
      photo,
      sourceId,
      leftoverId,
      sourcePortions
    });
  let shopText = $state('');
  let editingShop = $state('');
  let editedShopText = $state('');
  let search = $state('');
  let recipeFilters = $state<string[]>([]);
  function addRecipeFilter(value = search) {
    const name = value.trim();
    if (!name) return;
    const label = findIngredient(plan.weekly?.ingredientLibrary ?? [], name)?.name ?? name;
    if (!recipeFilters.some((item) => ingredientKey(item) === ingredientKey(label)))
      recipeFilters = [...recipeFilters, label];
    search = '';
  }
  let useSoonText = $state('');
  let filterUseSoon = $state(false);
  const useSoon = $derived(extras(plan).useSoon ?? []);
  $effect(() => {
    if (!useSoon.length) filterUseSoon = false;
  });
  let notice = $state('');
  let noticeIsWarning = $state(false);
  let noticeVersion = $state(0);
  let noticeHovered = $state(false);
  let noticeFocused = $state(false);
  let noticeRemaining = $state(6000);
  $effect(() => {
    noticeVersion;
    notice;
    noticeRemaining = 6000;
  });
  $effect(() => {
    if (!notice || noticeHovered || noticeFocused) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      noticeRemaining = Math.max(0, noticeRemaining - (now - previous));
      previous = now;
      if (!noticeRemaining) notice = '';
    }, 50);
    return () => clearInterval(timer);
  });
  let error = $state('');
  let undoPlan = $state<KitchenPlan | null>(null);
  let dragged = $state('');
  let dropDay = $state('');
  let opener: HTMLElement | null = null;
  let renderedDays = $state(28);
  const settings = $derived(planningSettings(plan));
  const days = $derived(
    Array.from({ length: Math.min(visibleDays, renderedDays) }, (_, i) => addDays(week, i))
  );
  const sections = $derived(visibleSections(plan, days));
  const weeklyMeals = $derived(
    plan.activities.filter((a) => a.kind !== 'other' && days.includes(a.start.day))
  );
  const sessions = $derived(plan.weekly?.sessions ?? []);
  const weekSessions = $derived(
    sessions
      .filter(
        (s) =>
          days.includes(s.day) || servingSlots(plan, s.id).some((slot) => days.includes(slot.day))
      )
      .sort((a, b) => a.day.localeCompare(b.day))
  );
  const remaining = (id: string) =>
    (sessions.find((s) => s.id === id)?.quantity ?? 0) -
    servingSlots(plan, id).reduce((n, s) => n + s.portions, 0);
  const sourceSessions = $derived(
    sessions.filter(
      (s) =>
        s.id === sourceId ||
        (s.day >= addDays(date || week, -7) && s.day <= (date || week) && remaining(s.id) > 0)
    )
  );
  const shopping = $derived(extras(plan).shopping);
  const leftoverRemaining = (id: string) =>
    Math.max(
      0,
      (plan.batches.find((b) => b.id === id)?.quantity ?? 0) -
        Object.entries(extras(plan).leftoverSources ?? {})
          .filter(
            ([mealId, link]) => link.batchId === id && plan.activities.some((a) => a.id === mealId)
          )
          .reduce((sum, [, link]) => sum + link.portions, 0)
    );
  function chooseLeftover(batch: Batch) {
    newMeal(date, slot, batch.name, 'leftovers', '', [], plan.weekly?.images?.[batch.id] ?? '');
    leftoverId = batch.id;
    sourcePortions = Math.min(preferredPortions, leftoverRemaining(batch.id));
    initialDraft = draftKey();
  }
  const leftovers = $derived(plan.batches.filter((b) => b.source.kind === 'existing'));
  const preparationSummary = $derived.by(() => {
    const parts = [];
    if (useSoon.length) parts.push(i18n.t('planner.ingredientCount', { count: useSoon.length }));
    if (weekSessions.length)
      parts.push(i18n.t('planner.cookCount', { count: weekSessions.length }));
    if (visibleLeftovers.length)
      parts.push(i18n.t('planner.leftoverCount', { count: visibleLeftovers.length }));
    const available =
      visibleLeftovers.reduce((n, b) => n + leftoverRemaining(b.id), 0) +
      weekSessions.reduce((n, s) => n + Math.max(0, remaining(s.id)), 0);
    if (weekSessions.length || visibleLeftovers.length)
      parts.push(
        available > 0
          ? i18n.t('planner.portionsToPlan', { count: available })
          : i18n.t('planner.allPlanned')
      );
    return parts.join(' · ') || i18n.t('planner.ingredientsCookingPlansAndLeftovers');
  });
  const visibleLeftovers = $derived(
    leftovers.filter(
      (b) =>
        leftoverRemaining(b.id) > 0 ||
        Object.entries(extras(plan).leftoverSources ?? {}).some(
          ([id, link]) => link.batchId === b.id && weeklyMeals.some((a) => a.id === id)
        )
    )
  );
  const recipes = $derived(
    availableRecipes
      .filter(
        (r) =>
          (!bookFilter || bookForRecipe(r.id)?.id === bookFilter) &&
          recipeIngredientSearch(r, plan.weekly?.ingredientLibrary ?? [], search) &&
          recipeHasIngredients(r, plan.weekly?.ingredientLibrary ?? [], recipeFilters) &&
          (!filterUseSoon || recipeMatches(r, useSoon).length > 0)
      )
      .sort((a, b) =>
        filterUseSoon ? recipeMatches(b, useSoon).length - recipeMatches(a, useSoon).length : 0
      )
  );
  const icons = { cook: 'bowl', leftovers: 'leaf', easy: 'sun' } as const;
  const loaded = $derived(persistence.loaded && persistence.phase !== 'loading');
  const dateLabel = (day: string, options: Intl.DateTimeFormatOptions) =>
    parseDay(day).toLocaleDateString(i18n.tag, options);
  const uid = () => newId('weekly');
  const clone = (p: KitchenPlan): KitchenPlan => JSON.parse(JSON.stringify(p));

  $effect(() => {
    if (loaded) {
      try {
        sessionStorage.setItem(`meal-prep:last-week:${storageScope()}`, week);
      } catch {
        /* Optional navigation memory. */
      }
    }
  });

  onMount(() => {
    let disposed = false;
    const canRefresh = () =>
      document.visibilityState === 'visible' &&
      !document.querySelector('dialog[open]') &&
      !document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') &&
      !dragged;
    const refreshShared = () => {
      if (!canRefresh() || !account) return;
      void refreshBooks(canRefresh);
      if (persistence.phase === 'error' && navigator.onLine) void sync?.retry();
      else void sync?.refresh();
    };
    const reconnect = refreshShared;
    const sharedTimer = setInterval(refreshShared, 5000);
    window.addEventListener('focus', refreshShared);
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', refreshShared);
    void initialize();
    async function initialize() {
      try {
        const response = await fetch('/api/account');
        if (disposed) return;
        if (response.status === 401) {
          await goto('/sign-in', { replaceState: true });
          return;
        }
        if (!response.ok) throw new Error(i18n.t('planner.unableToLoadYourAccount'));
        const value: Account = await response.json();
        if (disposed) return;
        if (!value.household) {
          await goto('/household', { replaceState: true });
          return;
        }
        account = value;
        await i18n.loadAccount(value);
        setAccountContext(value);
        try {
          const savedTab = sessionStorage.getItem(`meal-prep:page:${storageScope()}`);
          if (
            savedTab === 'week' ||
            savedTab === 'recipes' ||
            savedTab === 'shopping' ||
            savedTab === 'settings'
          )
            tab = savedTab;
        } catch {}
        if (new URL(location.href).searchParams.get('view') === 'recipes') {
          tab = 'recipes';
          try {
            sessionStorage.setItem(`meal-prep:page:${storageScope()}`, 'recipes');
          } catch {}
          replaceState('/', page.state);
        }
        document.documentElement.removeAttribute('data-theme');
        try {
          const savedWeek = sessionStorage.getItem(`meal-prep:last-week:${storageScope()}`);
          if (savedWeek) {
            parseDay(savedWeek);
            week = savedWeek;
          }
        } catch {
          /* A blocked browser store should not prevent planning. */
        }
        const key = `meal-prep:unsaved-plan:v1:${storageScope()}`;
        sync = new PlanSync({
          transport: httpPlanTransport(accountFetch(value)),
          canRefresh,
          drafts: {
            read: () => sessionStorage.getItem(key),
            write: (value) => sessionStorage.setItem(key, value),
            remove: () => sessionStorage.removeItem(key)
          },
          onState: (value) => (persistence = value),
          onHydrate: (value) => {
            plan = linkIngredients(value);
            visibleDays = planningSettings(plan).daysShown;
            let restored = false;
            try {
              restored = !!sessionStorage.getItem(`meal-prep:last-week:${storageScope()}`);
            } catch {}
            if (!restored) {
              week = planningStart(todayDay(), planningSettings(plan));
              visibleDays = planningSettings(plan).daysShown;
            }
            if (JSON.stringify(plan) !== JSON.stringify(value)) sync.change(plan);
            undoPlan = null;
          }
        });
        await refreshBooks();
        await sync.start();
      } catch {
        account = null;
        accountError = i18n.t('planner.unableToLoadYourAccountPleaseReload');
      }
    }
    return () => {
      disposed = true;
      clearInterval(sharedTimer);
      window.removeEventListener('focus', refreshShared);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', refreshShared);
      sync?.dispose();
    };
  });
  function commit(next: KitchenPlan, message = '') {
    if (!loaded) return false;
    try {
      next = linkIngredients(retainPlannedRecipes(next));
      parseKitchenPlan(next);
      undoPlan = clone(plan);
      plan = next;
      sync.change(next);
      noticeVersion++;
      notice = message;
      noticeIsWarning = false;
      error = '';
      return true;
    } catch {
      error = i18n.t('planner.thisChangeCouldNotBeSavedCheck');
      return false;
    }
  }
  async function removeCookingSession(id: string) {
    const linked = servingSlots(plan, id);
    let choice: string | null = 'keep';
    if (linked.length) {
      choice = await askChoice(
        i18n.t('planner.removeCookingPlan2'),
        i18n.t('planner.removeCookQuestion', { count: linked.length }),
        [
          { value: 'keep', label: i18n.t('planner.keepMeals') },
          { value: 'remove', label: i18n.t('planner.removeMealsToo') }
        ]
      );
    }
    if (!choice) return false;
    return commit(
      removeCooking(plan, id, choice === 'remove'),
      choice === 'remove'
        ? i18n.t('planner.cookingPlanAndLinkedMealsRemoved')
        : i18n.t('planner.cookingPlanRemoved')
    );
  }
  function undo() {
    if (!undoPlan) return;
    const previous = undoPlan;
    plan = previous;
    sync.change(previous);
    undoPlan = null;
    noticeVersion++;
    notice = i18n.t('planner.changeUndone');
    noticeIsWarning = false;
  }
  async function show(kind: NonNullable<typeof modal>) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    error = '';
    photoOpen = false;
    modal = kind;
    initialDraft = draftKey();
    await tick();
    dialog?.showModal();
    if (!editing && kind !== 'meal-choice')
      dialog?.querySelector<HTMLInputElement>('.wp-food-dialog-heading input')?.focus();
  }
  async function close(force = false) {
    if (recipeSaving) return false;
    if (
      !force &&
      draftKey() !== initialDraft &&
      !(await confirmAction(i18n.t('planner.discardTheseUnsavedEdits')))
    )
      return false;
    dialog?.close();
    modal = null;
    error = '';
    opener?.focus({ preventScroll: true });
    return true;
  }
  function newMeal(
    day = days.includes(todayDay()) ? todayDay() : week,
    meal: MealSlot = 'Dinner',
    name = '',
    kind: MealStyle = 'cook',
    instructions = '',
    ingredients: Recipe['ingredients'] = [],
    image = ''
  ) {
    editing = '';
    title = name;
    date = day;
    slot = meal;
    style = kind;
    notes = instructions;
    photo = image;
    sourceId = '';
    leftoverId = '';
    sourcePortions = preferredPortions;
    mealIngredients = ingredients;
    shopWithMeal = false;
    void show(!name && kind === 'cook' ? 'meal-choice' : 'meal');
  }
  function editMeal(a: Activity) {
    editing = a.id;
    title = a.title;
    date = a.start.day;
    slot = mealSlot(a, plan);
    style = mealStyle(plan, a);
    notes = a.notes;
    photo = plan.weekly?.images?.[a.id] ?? '';
    sourceId = plan.weekly?.mealSources?.[a.id]?.sessionId ?? '';
    leftoverId = plan.weekly?.leftoverSources?.[a.id]?.batchId ?? '';
    sourcePortions =
      plan.weekly?.mealSources?.[a.id]?.portions ??
      plan.weekly?.leftoverSources?.[a.id]?.portions ??
      2;
    mealIngredients = [];
    shopWithMeal = false;
    void show('meal');
  }
  function newRecipe(recipe?: Recipe, suggestedName = '') {
    currentEntry = catalog.recipes.find((r) => snapshotId(r) === recipe?.id);
    recipeDraftId = uid();
    recipeBookId =
      bookForRecipe(recipe?.id ?? '')?.id ??
      (writableBooks.some((b) => b.id === bookFilter) ? bookFilter : catalog.defaultBookId);
    photo = cookingPlan.weekly?.images?.[recipe?.id ?? ''] ?? '';
    editing = recipe?.id ?? '';
    title = recipe?.name ?? suggestedName;
    notes = recipe?.instructions ?? '';
    portions = recipe?.yieldQuantity ?? 4;
    const originalRecipe =
      catalog.recipes.find((r) => snapshotId(r) === recipe?.id)?.recipe ?? recipe;
    recipeIngredients = originalRecipe?.ingredients.length
      ? originalRecipe.ingredients
      : [{ id: uid(), name: '', quantity: 1, unit: '', preparation: '' }];
    recipePaste = '';
    void show('recipe');
  }
  function newLeftover(batch?: Batch) {
    leftoverRecipeId = batch?.recipeId ?? '';
    photo = plan.weekly?.images?.[batch?.id ?? ''] ?? '';
    editing = batch?.id ?? '';
    title = batch?.name ?? '';
    portions = batch?.quantity ?? 2;
    notes = '';
    sourceId = '';
    leftoverId = '';
    void show('leftover');
  }
  function imageRecord(id: string) {
    const photo = dialogPhoto;
    const images = { ...extras(plan).images };
    if (photo) images[id] = photo;
    else delete images[id];
    return images;
  }
  function chooseSource(id: string) {
    sourceId = id;
    const session = sessions.find((s) => s.id === id);
    if (session) {
      title = session.name;
      sourcePortions = Math.min(sourcePortions, remaining(id));
      notes = session.notes;
      photo = plan.weekly?.images?.[id] ?? '';
      style = 'leftovers';
    }
  }
  function openCooking(
    recipe?: Recipe,
    session?: CookingSession,
    day = days.includes(todayDay()) ? todayDay() : week,
    firstMeal?: MealSlot
  ) {
    cooking = { recipe, session, day, firstMeal };
  }
  function addUseSoon(value = useSoonText) {
    const name = value.trim();
    if (
      name &&
      commit(
        { ...plan, weekly: { ...extras(plan), useSoon: [...useSoon, { id: uid(), name }] } },
        i18n.t('planner.ingredientAdded')
      )
    )
      useSoonText = '';
  }
  function removeUseSoon(id: string) {
    commit(
      { ...plan, weekly: { ...extras(plan), useSoon: useSoon.filter((item) => item.id !== id) } },
      i18n.t('planner.ingredientRemoved')
    );
  }
  function chooseLeftoverRecipe(recipe: Recipe) {
    leftoverRecipeId = recipe.id;
    title = recipe.name;
    photo = cookingPlan.weekly?.images?.[recipe.id] ?? '';
    portions = recipe.yieldQuantity;
  }

  async function save() {
    if (recipeSaving) return;
    if (photoBusy) return;
    if (!title.trim()) return;
    if (modal === 'meal') {
      const source = sessions.find((s) => s.id === sourceId);
      if (source && date < source.day) {
        error = i18n.t('planner.chooseAMealOnOrAfterThe');
        return;
      }
      const previousPortions =
        plan.weekly?.mealSources?.[editing]?.sessionId === sourceId
          ? plan.weekly.mealSources[editing].portions
          : 0;
      if (source && sourcePortions > remaining(sourceId) + previousPortions) {
        error = i18n.t('planner.availableError', { count: remaining(sourceId) + previousPortions });
        return;
      }
      if (leftoverId) {
        const previous =
          extras(plan).leftoverSources?.[editing]?.batchId === leftoverId
            ? extras(plan).leftoverSources![editing].portions
            : 0;
        if (sourcePortions > leftoverRemaining(leftoverId) + previous) {
          error = i18n.t('planner.notEnoughLeftoverPortionsChooseFewerPortions');
          return;
        }
      }
      const leftoverSources = { ...extras(plan).leftoverSources };
      const existing = plan.activities.find((a) => a.id === editing);
      const id = existing?.id ?? uid();
      if (leftoverId) leftoverSources[id] = { batchId: leftoverId, portions: sourcePortions };
      else delete leftoverSources[id];
      const activity: Activity = {
        ...(existing ?? { id, elapsedMinutes: 30, handsOnMinutes: 0, requiresHome: false }),
        title: title.trim(),
        kind: style === 'cook' ? 'cook' : 'meal',
        notes,
        start: {
          day: date,
          minute:
            existing && mealSlot(existing, plan) === slot
              ? existing.start.minute
              : minuteForSlot(slot)
        }
      };
      const images = { ...extras(plan).images };
      if (photo) images[id] = photo;
      else delete images[id];
      const mealSources = { ...extras(plan).mealSources };
      if (sourceId) mealSources[id] = { sessionId: sourceId, portions: sourcePortions };
      else delete mealSources[id];
      commit(
        {
          ...plan,
          activities: [...plan.activities.filter((a) => a.id !== id), activity],
          weekly: {
            ...extras(plan),
            images,
            mealSources,
            mealSections: { ...extras(plan).mealSections, [id]: slot },
            leftoverSources,
            shopping: shopWithMeal
              ? shoppingWith(
                  mealIngredients.map((i) =>
                    i.unit !== undefined
                      ? ingredientLine(i)
                      : i.quantity === 1
                        ? i.name
                        : `${i.quantity} ${i.name}`
                  )
                )
              : shopping,
            styles: { ...extras(plan).styles, [id]: style }
          }
        },
        existing ? i18n.t('planner.mealUpdated') : i18n.t('planner.mealAdded')
      );
      if (!error) {
        if (!days.includes(date)) week = date;
        tab = 'week';
      }
    } else if (modal === 'recipe') {
      if (recipeReadOnly) {
        await close(true);
        return;
      }
      recipeSaving = true;
      catalogRequest++;
      try {
        const recipe: Recipe = {
          id: currentEntry?.recipe.id ?? recipeDraftId,
          name: title.trim(),
          yieldQuantity: portions,
          durationMinutes: currentEntry?.recipe.durationMinutes ?? 30,
          ingredients: [
            ...recipeIngredients.filter((row) => row.name.trim()),
            ...recipePaste
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => parseRecipeIngredientLine(line))
          ],
          instructions: notes
        };
        catalog = await bookRequest({
          action: 'save',
          book: recipeBookId,
          recipe,
          image: photo,
          revision: currentEntry?.revision ?? 0
        });
        const learned = linkIngredients({ ...plan, recipes: [...plan.recipes, recipe] });
        commit({
          ...plan,
          weekly: { ...extras(plan), ingredientLibrary: learned.weekly?.ingredientLibrary }
        });
        undoPlan = null;
        noticeVersion++;
        notice = i18n.t('planner.recipeSaved');
        noticeIsWarning = false;
      } catch (cause) {
        error = i18n.error(
          cause instanceof Error ? cause.message : 'Unable to update recipe books.'
        );
        if (cause instanceof BookRequestError && [403, 404, 409].includes(cause.status))
          await refreshBooks();
      } finally {
        recipeSaving = false;
      }
    } else if (modal === 'leftover') {
      const id = editing || uid();
      const old = plan.batches.find((b) => b.id === id);
      const planned = (old?.quantity ?? 0) - leftoverRemaining(id);
      if (portions < planned) {
        error = i18n.t('planner.plannedError', { count: planned });
        return;
      }
      const batch: Batch = {
        ...(leftoverRecipeId ? { recipeId: leftoverRecipeId } : {}),
        id,
        name: title.trim(),
        quantity: portions,
        unit: old?.unit ?? 'portions',
        source: old?.source ?? { kind: 'existing', availableAt: { day: todayDay(), minute: 0 } }
      };
      commit(
        {
          ...plan,
          recipes: cookingPlan.recipes,
          batches: [...plan.batches.filter((b) => b.id !== id), batch],
          weekly: { ...extras(plan), images: { ...cookingPlan.weekly?.images, ...imageRecord(id) } }
        },
        i18n.t('planner.leftoversUpdated')
      );
    }
    if (!error) close(true);
  }
  function removeMeal(id: string) {
    const leftoverSources = { ...extras(plan).leftoverSources };
    delete leftoverSources[id];
    const styles = { ...extras(plan).styles };
    const mealSources = { ...extras(plan).mealSources };
    const images = { ...extras(plan).images };
    delete styles[id];
    delete mealSources[id];
    delete images[id];
    commit(
      {
        ...deleteActivity(plan, id),
        weekly: { ...extras(plan), styles, mealSources, leftoverSources, images }
      },
      i18n.t('planner.mealRemoved')
    );
  }
  async function remove() {
    if (modal === 'meal') {
      removeMeal(editing);
    } else if (modal === 'recipe') {
      if (!currentEntry || recipeSaving) return;
      if (
        !(await confirmAction(
          i18n.t('books.deleteRecipePrompt'),
          i18n.t('planner.remove'),
          i18n.t('books.deleteRecipe')
        ))
      )
        return;
      recipeSaving = true;
      catalogRequest++;
      try {
        catalog = await bookRequest({
          action: 'remove-recipe',
          id: currentEntry.recipe.id,
          revision: currentEntry.revision
        });
      } catch (cause) {
        error = i18n.error(
          cause instanceof Error ? cause.message : 'Unable to update recipe books.'
        );
        if (cause instanceof BookRequestError && [403, 404, 409].includes(cause.status))
          await refreshBooks();
        return;
      } finally {
        recipeSaving = false;
      }
    } else if (!(await removeLeftover(editing))) return;
    close(true);
  }
  function shoppingWith(names: string[]) {
    const next = [...shopping];
    for (const name of names.map((n) => n.trim()).filter(Boolean)) {
      if (!next.some((item) => !item.checked && item.name.toLowerCase() === name.toLowerCase()))
        next.push({ id: uid(), name, checked: false });
    }
    return next;
  }
  function addShopping(names: string[]) {
    return commit(
      { ...plan, weekly: { ...extras(plan), shopping: shoppingWith(names) } },
      i18n.t('planner.shoppingListUpdated')
    );
  }
  async function removeLeftover(id: string) {
    const linked = Object.entries(extras(plan).leftoverSources ?? {})
      .filter(
        ([mealId, link]) => link.batchId === id && plan.activities.some((a) => a.id === mealId)
      )
      .map(([mealId]) => mealId);
    const choice = linked.length
      ? await askChoice(
          i18n.t('planner.removeLeftovers2'),
          i18n.t('planner.removeLeftoverQuestion', { count: linked.length }),
          [
            { value: 'keep', label: i18n.t('planner.keepMeals') },
            { value: 'remove', label: i18n.t('planner.removeMealsToo') }
          ]
        )
      : 'keep';
    if (!choice) return false;
    let next = plan;
    if (choice === 'remove') for (const mealId of linked) next = deleteActivity(next, mealId);
    const weekly = { ...extras(next) };
    weekly.leftoverSources = Object.fromEntries(
      Object.entries(weekly.leftoverSources ?? {}).filter(([, link]) => link.batchId !== id)
    );
    if (choice === 'remove') {
      const withoutMeals = <T,>(record: Record<string, T> = {}) =>
        Object.fromEntries(Object.entries(record).filter(([mealId]) => !linked.includes(mealId)));
      weekly.styles = withoutMeals(weekly.styles);
      weekly.images = withoutMeals(weekly.images);
      weekly.mealSources = withoutMeals(weekly.mealSources);
    }
    return commit(
      {
        ...next,
        batches: next.batches.filter((b) => b.id !== id),
        allocations: next.allocations.filter((a) => a.batchId !== id),
        weekly
      },
      choice === 'remove'
        ? i18n.t('planner.leftoversAndLinkedMealsRemoved')
        : i18n.t('planner.leftoversRemoved')
    );
  }
  function duplicateMeal() {
    if (!dialog?.querySelector('form')?.reportValidity() || photoBusy) return;
    save();
    if (error || modal !== null) return;
    const original = plan.activities.find((a) => a.id === editing);
    if (!original || sourceId || leftoverId || style !== 'easy') return;
    const id = uid();
    if (
      commit(
        {
          ...plan,
          activities: [...plan.activities, { ...original, id }],
          weekly: {
            ...extras(plan),
            styles: { ...extras(plan).styles, [id]: 'easy' },
            images: {
              ...extras(plan).images,
              ...(plan.weekly?.images?.[editing] ? { [id]: plan.weekly.images[editing] } : {})
            }
          }
        },
        i18n.t('planner.mealDuplicated')
      )
    )
      void close(true);
  }
  function warn(message: string) {
    noticeVersion++;
    notice = message;
    noticeIsWarning = true;
  }
  function touchHandlers(id: string, enabled = true) {
    const target = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y);
      const day = element?.closest<HTMLElement>('[data-agenda-day]')?.dataset.agendaDay;
      const meal = element?.closest<HTMLElement>('[data-meal-slot]')?.dataset.mealSlot as
        MealSlot | undefined;
      return { day, meal };
    };
    return {
      start: () => {
        if (!enabled) return false;
        dragged = id;
        return true;
      },
      move: (x: number, y: number) => {
        const { day, meal } = target(x, y);
        dropDay =
          day && !blockedDrop(day, meal)
            ? id.startsWith('reschedule:')
              ? `cook:${day}`
              : meal
                ? `${day}:${meal}`
                : ''
            : '';
      },
      end: (x: number, y: number) => {
        const { day, meal } = target(x, y);
        if (day && !blockedDrop(day, meal)) {
          if (id.startsWith('reschedule:')) moveCooking(day);
          else if (meal) moveMeal(day, meal);
        }
        dragged = '';
        dropDay = '';
      },
      cancel: () => {
        dragged = '';
        dropDay = '';
      }
    };
  }
  async function keyboardMove(event: KeyboardEvent, id: string) {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
      return;
    event.preventDefault();
    const cook = id.startsWith('reschedule:')
      ? sessions.find((s) => s.id === id.slice(11))
      : undefined;
    const meal = plan.activities.find((a) => a.id === id);
    if (!cook && !meal) return;
    const changeDay = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (cook && !changeDay) return;
    const day = addDays(cook?.day ?? meal!.start.day, changeDay);
    const currentSection = meal ? mealSlot(meal, plan) : '';
    const sectionIndex = sections.findIndex((s) => s.id === currentSection);
    const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const targetSlot = meal
      ? (sections[Math.max(0, Math.min(sections.length - 1, sectionIndex + offset))]?.id ??
        currentSection)
      : undefined;
    dragged = id;
    const reason = blockedDrop(day, targetSlot);
    if (reason) {
      warn(reason);
      dragged = '';
      return;
    }
    if (cook) moveCooking(day);
    else moveMeal(day, targetSlot!);
    if (!days.includes(day)) week = day;
    await tick();
    document.querySelector<HTMLElement>(`[data-drag-id="${CSS.escape(id)}"]`)?.focus();
  }
  function blockedDrop(day: string, slot?: MealSlot): string {
    if (!dragged) return '';
    if (dragged.startsWith('reschedule:')) {
      return servingSlots(plan, dragged.slice(11)).some((s) => s.day < day)
        ? i18n.t('planner.cookingMustBeBeforeItsPlannedMeals')
        : '';
    }
    if (slot && !settings.sections.find((s) => s.id === slot)?.enabled)
      return i18n.t('planner.thisSectionIsTurnedOff');
    if (dragged.startsWith('cook:')) {
      const id = dragged.slice(5);
      const session = sessions.find((s) => s.id === id);
      if (session && day < session.day) return i18n.t('planner.beforeTheCookingDay');
      if (remaining(id) <= 0) return i18n.t('planner.allPortionsArePlanned');
      if (slot && servingSlots(plan, id).some((s) => s.day === day && s.slot === slot))
        return i18n.t('planner.alreadyPlannedHere');
    } else {
      const source = sessions.find((s) => s.id === plan.weekly?.mealSources?.[dragged]?.sessionId);
      if (source && day < source.day) return i18n.t('planner.beforeTheCookingDay');
    }
    return '';
  }
  function moveCooking(day: string) {
    const id = dragged.slice('reschedule:'.length);
    const session = sessions.find((s) => s.id === id);
    if (session && session.day !== day) {
      const earlierMeals = servingSlots(plan, id).some((slot) => slot.day < day);
      if (earlierMeals) {
        warn(i18n.t('planner.cookingMustStayOnOrBeforeIts'));
        dragged = '';
        dropDay = '';
        return;
      }
      commit(
        {
          ...plan,
          weekly: {
            ...extras(plan),
            sessions: sessions.map((s) => (s.id === id ? { ...s, day } : s))
          }
        },
        i18n.t('planner.cookingMoved')
      );
    }
    dragged = '';
    dropDay = '';
  }
  function moveMeal(day: string, targetSlot: MealSlot) {
    const reason = blockedDrop(day, targetSlot);
    if (reason) {
      warn(reason);
      dragged = '';
      dropDay = '';
      return;
    }
    if (dragged.startsWith('reschedule:')) {
      moveCooking(day);
      return;
    }

    if (dragged.startsWith('cook:')) {
      const session = sessions.find((s) => s.id === dragged.slice(5));
      if (session) {
        const available = remaining(session.id);
        if (day < session.day) warn(i18n.t('planner.chooseAMealOnOrAfterThe'));
        else if (available <= 0) warn(i18n.t('planner.allPortionsArePlannedEditTheCook'));
        else if (servingSlots(plan, session.id).some((s) => s.day === day && s.slot === targetSlot))
          warn(i18n.t('planner.thisCookIsAlreadyInThatMeal'));
        else {
          const id = uid();
          commit(
            {
              ...plan,
              activities: [
                ...plan.activities,
                {
                  id,
                  title: session.name,
                  kind: 'meal',
                  start: { day, minute: minuteForSlot(targetSlot) },
                  elapsedMinutes: 30,
                  handsOnMinutes: 0,
                  requiresHome: false,
                  notes: session.notes
                }
              ],
              weekly: {
                ...extras(plan),
                mealSections: { ...extras(plan).mealSections, [id]: targetSlot },
                mealSources: {
                  ...extras(plan).mealSources,
                  [id]: { sessionId: session.id, portions: Math.min(preferredPortions, available) }
                },
                styles: {
                  ...extras(plan).styles,
                  [id]: day === session.day ? 'cook' : 'leftovers'
                },
                images: {
                  ...extras(plan).images,
                  ...(plan.weekly?.images?.[session.id]
                    ? { [id]: plan.weekly.images[session.id] }
                    : {})
                }
              }
            },
            i18n.t('planner.mealPlanned')
          );
        }
      }
    } else if (dragged.startsWith('leftover:')) {
      const batch = leftovers.find((b) => b.id === dragged.slice(9));
      if (batch && leftoverRemaining(batch.id) > 0) {
        const id = uid();
        commit(
          {
            ...plan,
            activities: [
              ...plan.activities,
              {
                id,
                title: batch.name,
                kind: 'meal',
                start: { day, minute: minuteForSlot(targetSlot) },
                elapsedMinutes: 30,
                handsOnMinutes: 0,
                requiresHome: false,
                notes: ''
              }
            ],
            weekly: {
              ...extras(plan),
              mealSections: { ...extras(plan).mealSections, [id]: targetSlot },
              styles: { ...extras(plan).styles, [id]: 'leftovers' },
              leftoverSources: {
                ...extras(plan).leftoverSources,
                [id]: {
                  batchId: batch.id,
                  portions: Math.min(preferredPortions, leftoverRemaining(batch.id))
                }
              },
              images: {
                ...extras(plan).images,
                ...(plan.weekly?.images?.[batch.id] ? { [id]: plan.weekly.images[batch.id] } : {})
              }
            }
          },
          i18n.t('planner.leftoversPlanned')
        );
      }
    } else if (dragged) {
      const source = sessions.find((s) => s.id === plan.weekly?.mealSources?.[dragged]?.sessionId);
      if (source && day < source.day) {
        warn(i18n.t('planner.chooseAMealOnOrAfterThe'));
        dragged = '';
        dropDay = '';
        return;
      }
      commit(
        {
          ...plan,
          weekly: {
            ...extras(plan),
            mealSections: { ...extras(plan).mealSections, [dragged]: targetSlot }
          },
          activities: plan.activities.map((a) =>
            a.id === dragged ? { ...a, start: { day, minute: minuteForSlot(targetSlot) } } : a
          )
        },
        i18n.t('planner.mealMoved')
      );
    }
    dragged = '';
    dropDay = '';
  }
  async function goToday() {
    week = planningStart(todayDay(), settings);
    renderedDays = 28;
    await tick();
    if (window.innerWidth <= 700)
      document.getElementById(`day-${todayDay()}`)?.scrollIntoView({ block: 'start' });
  }
  function validDayCount(count: number) {
    return (
      Number.isSafeInteger(count) &&
      count > 0 &&
      count <= Math.floor((Date.UTC(9999, 11, 31) - parseDay(week).getTime()) / 86400000)
    );
  }
  function saveSettings(value: PlanningSettings) {
    try {
      validateSettings(value);
      if (!validDayCount(value.daysShown))
        throw new Error(i18n.t('planner.chooseARangeEndingBeforeTheYear'));
      const changeView =
        value.startDay !== settings.startDay || value.daysShown !== settings.daysShown;
      if (!commit({ ...plan, weekly: { ...extras(plan), settings: value } })) return false;
      if (changeView) {
        week = planningStart(todayDay(), value);
        visibleDays = value.daysShown;
        renderedDays = 28;
      }
      return true;
    } catch (cause) {
      error =
        cause instanceof Error ? i18n.error(cause.message) : i18n.t('planner.checkYourSettings');
      return false;
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([sync.recoveryFile()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meal-prep-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head
  ><title>Meal Prep</title><meta
    name="description"
    content="A simple weekly meal plan, recipes you love, and a shared shopping list."
  /></svelte:head
>
<svelte:window
  onbeforeunload={(event) => {
    if (persistence.dirty) event.preventDefault();
  }}
/>

{#if !account}<main class="wp-access">
    <p role="status">{accountError || i18n.t('planner.openingYourKitchen')}</p>
    {#if accountError}<button class="wp-secondary" onclick={() => location.reload()}
        >{i18n.t('planner.tryAgain')}</button
      >{/if}
  </main>{:else}
  <div class="weekly-app">
    <aside class="wp-sidebar">
      <a class="wp-brand" href="/" aria-label={i18n.t('planner.mealPrepHome')}
        ><img
          class="wp-brand-logo"
          src="/images/brand/cat-chef.svg"
          alt=""
          width="36"
          height="43"
        /><span>Meal Prep<span class="wp-brand-dot">.</span></span></a
      >
      <p class="wp-eyebrow wp-nav-label">{i18n.t('planner.yourKITCHEN')}</p>
      <nav aria-label={i18n.t('planner.mainNavigation')}>
        <button class:active={tab === 'week'} onclick={() => navigateSection('week')}
          ><Icon name="calendar" />{i18n.t('planner.agenda')}</button
        >
        <button class:active={tab === 'recipes'} onclick={() => navigateSection('recipes')}
          ><Icon name="book" />{i18n.t('planner.recipes')}<span class="wp-nav-count"
            >{availableRecipes.length}</span
          ></button
        >
        <button class:active={tab === 'shopping'} onclick={() => navigateSection('shopping')}
          ><Icon name="cart" />{i18n.t(
            'planner.shopping'
          )}{#if shopping.filter((i) => !i.checked).length}<span class="wp-nav-count"
              >{shopping.filter((i) => !i.checked).length}</span
            >{/if}</button
        >
        <button class:active={tab === 'settings'} onclick={() => navigateSection('settings')}
          ><Icon name="settings" />{i18n.t('planner.settings')}</button
        >
      </nav>
      <div class="wp-sidebar-account" aria-label={i18n.t('planner.signedinUser')}>
        <span class="wp-account-avatar" aria-hidden="true"
          >{(account.user.name || account.user.email).slice(0, 1).toUpperCase()}</span
        >
        <div>
          <small>{i18n.t('planner.signedInAs')}</small>
          <span>{account.user.email}</span>
          <SignOut compact unsaved={persistence.dirty} />
        </div>
      </div>
    </aside>
    <main class="wp-main">
      <header class="wp-topbar">
        <span
          class="wp-save"
          data-testid="save-status"
          data-state={persistence.phase}
          aria-live="polite"
          ><span class:saved={persistence.phase === 'saved'}></span>{persistence.phase === 'saved'
            ? i18n.t('planner.saved')
            : persistence.phase === 'saving'
              ? i18n.t('planner.saving')
              : persistence.phase === 'loading'
                ? i18n.t('planner.loading')
                : i18n.t('planner.needsAttention')}</span
        >
      </header>
      {#if persistence.phase === 'error' || persistence.phase === 'conflict' || persistence.phase === 'recovery-error' || persistence.recoveryUnavailable}
        <div class="wp-alert" role="alert">
          <p>
            {persistence.phase === 'conflict'
              ? i18n.t('planner.someEditsCouldNotBeSafelyCombined')
              : persistence.phase === 'recovery-error'
                ? i18n.t('planner.yourRecoveredEditsCouldNotBeRead')
                : persistence.recoveryUnavailable
                  ? i18n.t('planner.browserRecoveryIsUnavailableWaitForSaved')
                  : persistence.loaded
                    ? i18n.t('planner.yourEditsHaveNotSavedYetKeep')
                    : i18n.t('planner.weCouldNotLoadYourPlanPlease')}
          </p>
          <div>
            {#if persistence.phase === 'error'}<button onclick={() => sync.retry()}
                >{i18n.t('planner.retry')}</button
              >{/if}<button onclick={download}>{i18n.t('planner.downloadMyEdits')}</button
            >{#if persistence.phase === 'conflict' || persistence.phase === 'recovery-error'}<button
                onclick={async () => {
                  if (
                    await confirmAction(
                      i18n.t('planner.discardLocalEditsAndLoadTheHouseholds'),
                      i18n.t('planner.loadSavedPlan')
                    )
                  )
                    void sync.reloadSaved();
                }}>{i18n.t('planner.loadSavedPlan')}</button
              >{/if}
          </div>
        </div>
      {/if}
      <div class="wp-content">
        {#if tab === 'week'}
          <section class="wp-intro wp-week-intro">
            <div>
              <h1>{i18n.t('planner.agenda')}</h1>
            </div>
          </section>

          {#snippet cookingOverview()}
            <section
              id="cooking-plans"
              class="wp-cooking-section"
              aria-label={i18n.t('planner.cookingSessions')}
            >
              <div class="wp-cooking-heading">
                <div>
                  <h2>{i18n.t('planner.cookingPlans')}</h2>
                </div>
                <button
                  class="wp-secondary"
                  disabled={!loaded || photoBusy}
                  onclick={() => openCooking()}
                  ><Icon name="plus" size={16} />{i18n.t('planner.planACook')}</button
                >
              </div>
              {#if !weekSessions.length}<p class="wp-cooking-empty">
                  {i18n.t('planner.noCookingPlannedInTheseDates')}
                </p>{/if}
              <div class="wp-cooking-cards">
                {#each weekSessions as session}{@const placed = servingSlots(
                    plan,
                    session.id
                  )}{@const assigned = placed.reduce((n, s) => n + s.portions, 0)}
                  <div
                    class="wp-food-card wp-cooking-row"
                    class:wp-fully-planned={assigned >= session.quantity}
                  >
                    <button
                      class="wp-cooking-card wp-food-content"
                      use:touchDrag={touchHandlers(
                        `cook:${session.id}`,
                        assigned < session.quantity
                      )}
                      draggable={assigned < session.quantity}
                      ondragstart={(e) => {
                        dragged = `cook:${session.id}`;
                        e.dataTransfer?.setData('text/plain', dragged);
                      }}
                      ondragend={() => {
                        dragged = '';
                        dropDay = '';
                      }}
                      onclick={() => openCooking(undefined, session)}
                      aria-label={i18n.t('planner.editCook', { name: session.name })}
                      >{#if photoUrl(plan.weekly?.images?.[session.id])}<img
                          src={photoUrl(plan.weekly?.images?.[session.id])}
                          alt=""
                        />{:else}<span class="wp-cooking-symbol"
                          ><Icon name="bowl" size={30} /></span
                        >{/if}<span
                        ><strong>{session.name}</strong><span class="wp-food-meta">
                          <span title={i18n.t('planner.cookingDay')}
                            ><Icon name="calendar" size={13} />{dateLabel(session.day, {
                              weekday: 'short',
                              day: 'numeric'
                            })}</span
                          >
                          <span
                            title={i18n.t('planner.mealsPlanned', { count: placed.length })}
                            aria-label={i18n.t('planner.mealsPlanned', { count: placed.length })}
                            ><Icon name="check" size={13} />{i18n.t('planner.placedMeals', {
                              count: placed.length
                            })}</span
                          >
                          <span
                            title={i18n.t('planner.portionsAvailable', {
                              count: Math.max(0, session.quantity - assigned)
                            })}
                            aria-label={i18n.t('planner.portionsAvailable', {
                              count: Math.max(0, session.quantity - assigned)
                            })}
                            ><Icon
                              name={assigned >= session.quantity ? 'check' : 'bowl'}
                              size={13}
                            />{assigned >= session.quantity
                              ? i18n.t('planner.allPlanned')
                              : i18n.t('planner.portionsLeft', {
                                  count: session.quantity - assigned
                                })}</span
                          >
                        </span>{#if assigned > session.quantity || placed.some((s) => s.day < session.day)}<em
                            >{i18n.t('planner.checkMealDatesOrPortions')}</em
                          >{/if}</span
                      ></button
                    >
                    <div class="wp-food-actions">
                      <button
                        class="wp-icon-button wp-remove-leftover"
                        aria-label={i18n.t('planner.removeCook', { name: session.name })}
                        title={i18n.t('planner.removeCookingPlan')}
                        onclick={() => removeCookingSession(session.id)}
                        ><Icon name="trash" size={17} /></button
                      >
                    </div>
                  </div>{/each}
              </div>
            </section>
          {/snippet}
          <button
            class="wp-preparation-toggle"
            aria-label={i18n.t('planner.planPrepare')}
            aria-expanded={preparationExpanded}
            aria-controls="planning-tools"
            onclick={() => (preparationExpanded = !preparationExpanded)}
            ><Icon name="bowl" size={18} /><span
              >{i18n.t('planner.planPrepare')}<small>{preparationSummary}</small></span
            ><Icon name={preparationExpanded ? 'close' : 'plus'} size={16} /></button
          >
          {#if sessions.length || leftovers.length || weeklyMeals.length}<p class="wp-touch-hint">
              {i18n.t('planner.holdACardToDragItInto')}
            </p>{/if}
          <div
            id="planning-tools"
            class="wp-planning-workbench"
            class:wp-preparation-collapsed={!preparationExpanded}
          >
            <section id="use-soon" class="wp-panel" aria-label={i18n.t('planner.useSoon')}>
              <div class="wp-panel-heading">
                <h2>{i18n.t('planner.useSoon')}</h2>
              </div>
              <form
                class="wp-inline-add"
                onsubmit={(e) => {
                  e.preventDefault();
                  addUseSoon();
                }}
              >
                <IngredientInput
                  value={useSoonText}
                  library={cookingPlan.weekly?.ingredientLibrary ?? []}
                  label={i18n.t('planner.useSoonIngredient')}
                  onInput={(value) => (useSoonText = value)}
                  onSelect={(item) => addUseSoon(item.name)}
                /><button
                  aria-label={i18n.t('planner.addUsesoonIngredient')}
                  disabled={!useSoonText.trim()}><Icon name="plus" /></button
                >
              </form>
              <ul class="wp-use-soon-list">
                {#each useSoon as item (item.id)}<li>
                    <span>{item.name}</span><button
                      class="wp-ingredient-remove"
                      aria-label={i18n.t('planner.removeIngredientNamed', { name: item.name })}
                      title={i18n.t('planner.removeIngredient')}
                      onclick={() => removeUseSoon(item.id)}><Icon name="close" size={13} /></button
                    >
                  </li>{:else}<li class="wp-muted">
                    {i18n.t('planner.addIngredientsForRecipeSuggestions')}
                  </li>{/each}
              </ul>
            </section>
            <div class="wp-cooking-workspace">
              {@render cookingOverview()}
              <div class="wp-ready-strip">
                <section id="leftovers" class="wp-panel">
                  <div class="wp-panel-heading">
                    <div>
                      <h2>{i18n.t('planner.leftovers')}</h2>
                    </div>
                    <button
                      class="wp-secondary"
                      disabled={!loaded || photoBusy}
                      onclick={() => newLeftover()}
                      ><Icon name="plus" size={16} />{i18n.t('planner.add')}</button
                    >
                  </div>
                  <div class="wp-leftovers">
                    {#each visibleLeftovers as batch (batch.id)}<div
                        class="wp-leftover-row wp-food-card"
                        class:wp-fully-planned={leftoverRemaining(batch.id) === 0}
                      >
                        <button
                          class="wp-leftover-name"
                          use:touchDrag={touchHandlers(
                            `leftover:${batch.id}`,
                            leftoverRemaining(batch.id) > 0
                          )}
                          draggable={leftoverRemaining(batch.id) > 0}
                          aria-label={i18n.t('planner.editLeftoverNamed', { name: batch.name })}
                          ondragstart={(e) => {
                            dragged = `leftover:${batch.id}`;
                            e.dataTransfer?.setData('text/plain', dragged);
                          }}
                          ondragend={() => {
                            dragged = '';
                            dropDay = '';
                          }}
                          onclick={() => newLeftover(batch)}
                          >{#if photoUrl(plan.weekly?.images?.[batch.id])}<img
                              class="wp-leftover-photo"
                              src={photoUrl(plan.weekly?.images?.[batch.id])}
                              alt=""
                            />{:else}<span class="wp-food-icon"><Icon name="bowl" size={21} /></span
                            >{/if}<span
                            ><strong>{batch.name}</strong><span class="wp-food-meta"
                              ><span title={i18n.t('planner.availablePortions')}
                                ><Icon
                                  name={leftoverRemaining(batch.id) === 0 ? 'check' : 'bowl'}
                                  size={13}
                                />{#if leftoverRemaining(batch.id) === 0}{i18n.t(
                                    'planner.allPlanned'
                                  )}{:else}{!batch.unit || batch.unit === 'portions'
                                    ? i18n.t('recipes.portions', {
                                        count: leftoverRemaining(batch.id)
                                      })
                                    : i18n.number(leftoverRemaining(batch.id)) +
                                      ' ' +
                                      batch.unit}{/if}</span
                              ></span
                            ></span
                          ></button
                        >
                        <div class="wp-food-actions">
                          <button
                            class="wp-icon-button wp-remove-leftover"
                            aria-label={i18n.t('planner.removeLeftoverNamed', { name: batch.name })}
                            title={i18n.t('planner.removeLeftovers')}
                            onclick={() => removeLeftover(batch.id)}
                            ><Icon name="trash" size={17} /></button
                          >
                        </div>
                      </div>{:else}<div class="wp-empty-panel">
                        <Icon name="bowl" size={28} />
                        <p>{i18n.t('planner.noLeftoversYet')}</p>
                      </div>{/each}
                  </div>
                </section>
              </div>
            </div>
          </div>
          <div class="wp-week-toolbar">
            <div class="wp-week-title">
              <span
                >{dateLabel(week, { day: 'numeric', month: 'short' })} – {dateLabel(
                  addDays(week, visibleDays - 1),
                  { day: 'numeric', month: 'short', year: 'numeric' }
                )}</span
              >
            </div>
            <div class="wp-agenda-navigation">
              <div class="wp-week-controls">
                <button
                  aria-label={i18n.t('planner.previousDay')}
                  title={i18n.t('planner.moveViewBackOneDay')}
                  onclick={() => (week = addDays(week, -1))}><Icon name="left" size={18} /></button
                ><button title={i18n.t('planner.returnToYourPlanningStart')} onclick={goToday}
                  >{i18n.t('planner.today')}</button
                ><button
                  aria-label={i18n.t('planner.nextDay')}
                  title={i18n.t('planner.moveViewForwardOneDay')}
                  onclick={() => (week = addDays(week, 1))}><Icon name="right" size={18} /></button
                >
              </div>
            </div>
          </div>
          {#if sections.length === 2}<div class="wp-week-labels" aria-hidden="true">
              <span></span>{#each sections as section}<span>{i18n.section(section)}</span>{/each}
            </div>{/if}
          <div
            class="wp-week"
            class:wp-custom-sections={sections.length !== 2}
            id="meal-agenda"
            style={`--agenda-columns: ${Math.min(visibleDays, 7)}; --meal-rows: ${sections.length + 1}`}
            aria-label={i18n.t('planner.mealAgenda')}
          >
            {#each days as day}
              <section
                id={`day-${day}`}
                data-agenda-day={day}
                class="wp-day"
                class:wp-today={day === todayDay()}
                class:wp-cook-drop={dropDay === `cook:${day}`}
                class:wp-invalid-drop={!!dragged && !!blockedDrop(day)}
                title={dragged ? blockedDrop(day) : undefined}
                ondragover={(e) => {
                  if (dragged.startsWith('reschedule:')) {
                    e.preventDefault();
                    if (blockedDrop(day)) {
                      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                      dropDay = '';
                      return;
                    }
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    dropDay = `cook:${day}`;
                  }
                }}
                ondrop={(e) => {
                  if (dragged.startsWith('reschedule:')) {
                    e.preventDefault();
                    moveCooking(day);
                  }
                }}
                aria-label={dateLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}
              >
                <header class="wp-day-heading">
                  <span>{dateLabel(day, { weekday: 'short' })}</span><strong
                    >{parseDay(day).getDate()}</strong
                  >{#if day === todayDay()}<small>{i18n.t('planner.today')}</small>{/if}
                  {#each sessions.filter((session) => session.day === day) as session}
                    <button
                      class="wp-agenda-cook"
                      use:touchDrag={touchHandlers(`reschedule:${session.id}`)}
                      data-drag-id={`reschedule:${session.id}`}
                      aria-describedby="agenda-keyboard-help"
                      onkeydown={(event) => keyboardMove(event, `reschedule:${session.id}`)}
                      draggable="true"
                      ondragstart={(e) => {
                        dragged = `reschedule:${session.id}`;
                        e.dataTransfer?.setData('text/plain', dragged);
                      }}
                      ondragend={() => {
                        dragged = '';
                        dropDay = '';
                      }}
                      title={i18n.t('planner.cookNamed', { name: session.name })}
                      aria-label={i18n.t('planner.cookingOn', {
                        day: dateLabel(day, { weekday: 'long' }),
                        name: session.name
                      })}
                      onclick={() => openCooking(undefined, session)}
                      ><span class="wp-agenda-cook-label"
                        ><Icon name="bowl" size={14} />{i18n.t('planner.cooking')}</span
                      ><strong class="wp-agenda-cook-name">{session.name}</strong></button
                    >
                  {/each}
                </header>
                {#each sections as section}
                  {@const meal = section.id}
                  <div
                    class="wp-slot"
                    data-meal-slot={meal}
                    class:wp-drop={dropDay === `${day}:${meal}`}
                    class:wp-invalid-slot={!!dragged &&
                      !blockedDrop(day) &&
                      !!blockedDrop(day, meal)}
                    aria-disabled={!!dragged && !!blockedDrop(day, meal)}
                    title={dragged ? blockedDrop(day, meal) : undefined}
                    role="group"
                    aria-label={i18n.section(section)}
                    ondragover={(e) => {
                      if (dragged) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (blockedDrop(day, meal)) {
                          if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                          dropDay = '';
                          return;
                        }
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                        dropDay = dragged.startsWith('reschedule:')
                          ? `cook:${day}`
                          : `${day}:${meal}`;
                      }
                    }}
                    ondrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      moveMeal(day, meal);
                    }}
                  >
                    <p>
                      {i18n.section(section)}
                      {#if weeklyMeals.some((a) => a.start.day === day && mealSlot(a, plan) === meal)}<button
                          type="button"
                          class="wp-icon-button"
                          disabled={!section.enabled}
                          aria-label={i18n.t('planner.addSlot', {
                            section: i18n.section(section).toLowerCase(),
                            day: dateLabel(day, { weekday: 'long' })
                          })}
                          onclick={() => newMeal(day, meal)}><Icon name="plus" size={16} /></button
                        >{/if}
                    </p>
                    {#each weeklyMeals.filter((a) => a.start.day === day && mealSlot(a, plan) === meal) as activity (activity.id)}
                      {@const kind = mealStyle(plan, activity)}
                      {@const allocated =
                        plan.weekly?.mealSources?.[activity.id]?.portions ??
                        plan.weekly?.leftoverSources?.[activity.id]?.portions}
                      <div class="wp-meal-card">
                        <button
                          class="wp-meal {kind}"
                          use:touchDrag={touchHandlers(activity.id)}
                          data-drag-id={activity.id}
                          aria-describedby="agenda-keyboard-help"
                          onkeydown={(event) => keyboardMove(event, activity.id)}
                          draggable="true"
                          ondragstart={(e) => {
                            dragged = activity.id;
                            e.dataTransfer?.setData('text/plain', activity.id);
                          }}
                          ondragend={() => {
                            dragged = '';
                            dropDay = '';
                          }}
                          onclick={() => editMeal(activity)}
                          aria-label={i18n.t('planner.editMealNamed', { name: activity.title })}
                          >{#if photoUrl(plan.weekly?.images?.[activity.id])}<img
                              class="wp-meal-photo"
                              src={photoUrl(plan.weekly?.images?.[activity.id])}
                              alt=""
                              loading="lazy"
                            />{:else}<span class="wp-meal-symbol"
                              ><Icon name={icons[kind]} size={22} /></span
                            >{/if}<strong>{activity.title}</strong
                          >{#if allocated !== undefined}<span class="wp-meal-portions"
                              ><Icon name="bowl" size={13} />{i18n.t('recipes.portions', {
                                count: allocated
                              })}</span
                            >{/if}</button
                        >
                        <button
                          class="wp-board-remove"
                          aria-label={i18n.t('planner.removeMealNamed', { name: activity.title })}
                          title={i18n.t('planner.removeMeal')}
                          onclick={() => removeMeal(activity.id)}
                          ><Icon name="trash" size={14} /></button
                        >
                      </div>
                    {:else}
                      <button
                        class="wp-empty-slot"
                        disabled={!loaded || photoBusy || !section.enabled}
                        aria-label={i18n.t('planner.addSlot', {
                          section: i18n.section(section).toLowerCase(),
                          day: dateLabel(day, { weekday: 'long' })
                        })}
                        onclick={() => newMeal(day, meal)}
                        ><Icon name="plus" size={17} /><span>{i18n.t('planner.addMeal')}</span
                        ></button
                      >
                    {/each}
                  </div>
                {/each}
              </section>
            {/each}
          </div>
          {#if days.length < visibleDays}<button
              class="wp-secondary"
              onclick={() => (renderedDays += 28)}>{i18n.t('planner.showMoreDays')}</button
            >{/if}
          <div class="wp-week-caption">
            <p>{i18n.t('planner.dragToPlanOnTouchScreensHold')}</p>
            <span id="agenda-keyboard-help" class="wp-sr-only"
              >{i18n.t('planner.toMoveWithAKeyboardHoldAlt')}</span
            >
          </div>
        {:else if tab === 'recipes'}
          <section class="wp-intro">
            <div>
              <h1>{i18n.t('planner.recipes')}</h1>
            </div>
            <div class="wp-page-actions">
              {#if account?.household?.role === 'owner'}<button
                  class="wp-secondary"
                  onclick={() => (bookManager = true)}>{i18n.t('books.manage')}</button
                >{/if}
              <button
                class="wp-secondary"
                disabled={!loaded || photoBusy}
                onclick={() => (libraryOpen = true)}>{i18n.t('planner.manageIngredients')}</button
              >
              <button
                class="wp-primary"
                disabled={!loaded || !catalogReady || !writableBooks.length || photoBusy}
                onclick={() => newRecipe()}
                ><Icon name="plus" size={18} />{i18n.t('planner.addARecipe')}</button
              >
            </div>
          </section>
          <div class="wp-recipe-search">
            <IngredientInput
              value={search}
              library={cookingPlan.weekly?.ingredientLibrary ?? []}
              label={i18n.t('common.searchRecipes')}
              placeholder={i18n.t('planner.searchRecipesOrIngredients')}
              descriptionId="recipe-search-help"
              newIngredientHint=""
              onInput={(value) => (search = value)}
              onSelect={(item) => addRecipeFilter(item.name)}
              onEnter={() => addRecipeFilter()}
            />
            <label class="wp-book-picker"
              ><Icon name="book" size={18} /><select
                aria-label={i18n.t('books.choose')}
                bind:value={bookFilter}
              >
                <option value="">{i18n.t('books.all')}</option>
                {#each catalog.books as book}<option value={book.id}>{book.name}</option>{/each}
              </select></label
            >
          </div>
          <p id="recipe-search-help" class="wp-search-help">
            {i18n.t('planner.pressEnterToAddAnIngredientFilter')}
            {#if search || recipeFilters.length || filterUseSoon || bookFilter}<button
                type="button"
                class="wp-clear-filters"
                onclick={() => {
                  search = '';
                  recipeFilters = [];
                  filterUseSoon = false;
                  bookFilter = '';
                }}>{i18n.t('planner.clearFilters')}</button
              >{/if}
          </p>
          {#if recipeFilters.length}<div
              class="wp-recipe-filters"
              role="group"
              aria-label={i18n.t('planner.ingredientFilters')}
            >
              {#each recipeFilters as ingredient}<button
                  type="button"
                  class="wp-filter-chip"
                  aria-label={i18n.t('recipes.removeFilter', { name: ingredient })}
                  onclick={() =>
                    (recipeFilters = recipeFilters.filter((item) => item !== ingredient))}
                  >{ingredient}<Icon name="close" size={13} /></button
                >{/each}
            </div>{/if}
          {#if useSoon.length}<div class="wp-recipe-use-soon">
              <p>
                <Icon name="leaf" size={16} /><strong>{i18n.t('planner.useSoon')}</strong><span
                  >{useSoon.map((item) => item.name).join(', ')}</span
                >
              </p>
              <label class="wp-check-row"
                ><input type="checkbox" bind:checked={filterUseSoon} />{i18n.t(
                  'planner.matchingRecipesOnly'
                )}</label
              >
            </div>{/if}
          <div class="wp-recipe-grid">
            {#each recipes as recipe}<article class="wp-recipe">
                <button
                  class="wp-recipe-open"
                  aria-label={i18n.t(
                    bookForRecipe(recipe.id)?.access === 'view'
                      ? 'books.viewRecipe'
                      : 'recipes.editNamed',
                    { name: recipe.name }
                  )}
                  onclick={() => newRecipe(recipe)}
                  ><div class="wp-recipe-art">
                    {#if photoUrl(cookingPlan.weekly?.images?.[recipe.id])}<img
                        src={photoUrl(cookingPlan.weekly?.images?.[recipe.id])}
                        alt={recipe.name}
                        loading="lazy"
                      />{:else}<Icon name="bowl" size={44} /><span
                        >{i18n.t('planner.fromYOURRECIPEBOOK')}</span
                      >{/if}
                  </div>
                  <div class="wp-recipe-title">
                    <h2>{recipe.name}</h2>
                    {#if catalog.books.length > 1}<small>{bookForRecipe(recipe.id)?.name}</small
                      >{/if}
                    <span
                      ><span class="wp-portions-label"
                        ><Icon name="bowl" size={13} />{i18n.t('recipes.metadata', {
                          portions: recipe.yieldQuantity,
                          ingredients: recipe.ingredients.length
                        })}</span
                      ></span
                    ><Icon name="right" size={18} />
                  </div>
                  {#if recipeMatches(recipe, useSoon).length}<p class="wp-match">
                      {i18n.t('recipes.uses', {
                        ingredients: recipeMatches(recipe, useSoon)
                          .map((i) => i.name)
                          .join(', ')
                      })}
                    </p>{/if}
                  <p>{recipe.instructions || i18n.t('planner.addAFewNotesToMakeNext')}</p>
                </button>
                <div class="wp-recipe-actions">
                  <button class="wp-primary" onclick={() => openCooking(recipe)}
                    >{i18n.t('planner.planACook')} <Icon name="plus" size={16} /></button
                  ><button
                    class="wp-secondary"
                    disabled={!recipe.ingredients.length}
                    onclick={() =>
                      addShopping(
                        recipe.ingredients.map((i) =>
                          i.unit !== undefined
                            ? ingredientLine(i)
                            : i.quantity === 1
                              ? i.name
                              : `${i.quantity} ${i.name}`
                        )
                      )}>{i18n.t('planner.shopIngredients')}</button
                  >
                </div>
              </article>{:else}<div class="wp-large-empty">
                <Icon name="book" size={44} />
                <h2>
                  {filterUseSoon
                    ? i18n.t('planner.noMatchingSavedRecipes')
                    : search || recipeFilters.length
                      ? i18n.t('planner.noRecipesFound')
                      : i18n.t('planner.noRecipesYet')}
                </h2>
                <p>
                  {filterUseSoon
                    ? i18n.t('planner.tryAnotherIngredientOrAddARecipe')
                    : search || recipeFilters.length
                      ? i18n.t('planner.tryAnotherSearchOrRemoveAnIngredient')
                      : i18n.t('planner.saveANameAFewIngredientsAnd')}
                </p>
                <button
                  class="wp-primary"
                  disabled={!loaded || photoBusy || !writableBooks.length}
                  onclick={() => newRecipe(undefined, search.trim() || recipeFilters.join(' '))}
                  >{search.trim() || recipeFilters.length
                    ? i18n.t('recipes.createNamed', {
                        name: search.trim() || recipeFilters.join(' ')
                      })
                    : filterUseSoon
                      ? i18n.t('planner.createARecipe')
                      : i18n.t('planner.saveYourFirstRecipe')}</button
                >
              </div>{/each}
          </div>
        {:else if tab === 'settings'}
          <PlanningSettingsPanel value={settings} onchange={saveSettings} />
          <HouseholdSettings {account} unsaved={persistence.dirty} />
        {:else}
          <ShoppingList
            {plan}
            {loaded}
            {commit}
            onAdd={addShopping}
            bind:shopText
            bind:editingShop
            bind:editedShopText
          />
        {/if}
        {#if notice}<div
            class="wp-toast"
            role="status"
            onpointerenter={() => (noticeHovered = true)}
            onpointerleave={() => (noticeHovered = false)}
            onfocusin={() => (noticeFocused = true)}
            onfocusout={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                noticeFocused = false;
            }}
          >
            <div
              class="wp-toast-countdown"
              aria-hidden="true"
              style:transform={`scaleX(${noticeRemaining / 6000})`}
            ></div>
            <Icon name={noticeIsWarning ? 'info' : 'check'} size={17} /><span>{notice}</span
            >{#if undoPlan && !noticeIsWarning}<button onclick={undo}
                >{i18n.t('planner.undo')}</button
              >{/if}<button
              aria-label={i18n.t('planner.dismissNotification')}
              onclick={() => (notice = '')}><Icon name="close" size={15} /></button
            >
          </div>{/if}
        {#if error && !modal}<p class="wp-alert" role="alert">{error}</p>{/if}
      </div>
    </main>
  </div>

  {#if modal}
    <dialog
      class="wp-dialog"
      class:wp-recipe-dialog={modal === 'recipe'}
      class:wp-food-dialog={modal !== 'meal-choice'}
      bind:this={dialog}
      oncancel={(e) => {
        e.preventDefault();
        close();
      }}
      onclick={(e) => {
        if (e.target === dialog) {
          const r = dialog.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
      aria-labelledby="wp-dialog-title"
    >
      <form
        onsubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {#if modal !== 'meal-choice'}
          <FoodDialogHeader
            title={modal === 'recipe'
              ? editing
                ? i18n.t('planner.editRecipe')
                : i18n.t('planner.addRecipe')
              : modal === 'leftover'
                ? editing
                  ? i18n.t('planner.editLeftovers')
                  : i18n.t('planner.addLeftovers')
                : editing
                  ? i18n.t('planner.editMeal')
                  : i18n.t('planner.addMeal')}
            titleId="wp-dialog-title"
            image={dialogPhoto}
            editable={!recipeReadOnly &&
              !photoOpen &&
              !boundRecipe &&
              !(modal === 'meal' && (style === 'leftovers' || sourceId || leftoverId))}
            onPhoto={() => (photoOpen = !photoOpen)}
          >
            {#if modal === 'leftover'}
              <RecipeInput
                hideLabel
                value={title}
                recipes={availableRecipes}
                {bookNames}
                library={cookingPlan.weekly?.ingredientLibrary}
                images={cookingPlan.weekly?.images}
                label={i18n.t('common.leftoverName')}
                onInput={(v) => {
                  title = v;
                  if (boundRecipe && v !== boundRecipe.name) leftoverRecipeId = '';
                }}
                onSelect={chooseLeftoverRecipe}
              />
            {:else if !(modal === 'meal' && !editing && style === 'leftovers' && !title)}
              <input
                readonly={recipeReadOnly}
                class="wp-header-name"
                aria-label={modal === 'recipe'
                  ? i18n.t('planner.name')
                  : i18n.t('planner.mealName')}
                bind:value={title}
                required
                maxlength="200"
                placeholder={modal === 'recipe'
                  ? i18n.t('planner.recipeName')
                  : i18n.t('planner.mealName')}
              />
            {/if}
          </FoodDialogHeader>
          {#if photoOpen && !boundRecipe}<PhotoPicker
              value={photo}
              onChange={(value) => (photo = value)}
              bind:busy={photoBusy}
              onDone={() => (photoOpen = false)}
            />{/if}
        {:else}
          <header>
            <div>
              <!-- svelte-ignore a11y_autofocus -->
              <h2 id="wp-dialog-title" tabindex="-1" autofocus>{i18n.t('planner.addAMeal')}</h2>
            </div>
          </header>
        {/if}
        {#if !photoOpen}
          {#if modal === 'meal-choice'}
            <p class="wp-modal-help">
              {dateLabel(date, { weekday: 'long', day: 'numeric', month: 'short' })} · {i18n.section(
                settings.sections.find((s) => s.id === slot) ?? { id: slot, name: slot }
              )}
            </p>
            <div class="wp-meal-choices">
              <button
                type="button"
                onclick={() => {
                  close(true);
                  openCooking(undefined, undefined, date, slot);
                }}
                ><Icon name="bowl" /><span
                  ><strong>{i18n.t('planner.cookSomething')}</strong><small
                    >{i18n.t('planner.chooseARecipeOrYourOwnDish')}</small
                  ></span
                ><Icon name="right" /></button
              >
              <button type="button" onclick={() => newMeal(date, slot, '', 'leftovers')}
                ><Icon name="leaf" /><span
                  ><strong>{i18n.t('planner.useAPlannedCookOrLeftovers')}</strong><small
                    >{i18n.t('planner.chooseFoodThenSetYourPortions')}</small
                  ></span
                ><Icon name="right" /></button
              >
              <button type="button" onclick={() => newMeal(date, slot, '', 'easy')}
                ><Icon name="sun" /><span
                  ><strong>{i18n.t('planner.somethingElse')}</strong><small
                    >{i18n.t('planner.eatingOutASandwichOrAQuick')}</small
                  ></span
                ><Icon name="right" /></button
              >
            </div>
          {:else}
            {#if modal === 'meal' && !editing && style === 'leftovers' && !title}
              <div class="wp-ready-options">
                {#each leftovers.filter((b) => leftoverRemaining(b.id) > 0) as batch}<button
                    type="button"
                    class="wp-ready-card"
                    onclick={() => chooseLeftover(batch)}
                  >
                    {#if photoUrl(plan.weekly?.images?.[batch.id])}<img
                        src={photoUrl(plan.weekly?.images?.[batch.id])}
                        alt=""
                      />{/if}<span
                      ><strong>{batch.name}</strong><small
                        >{i18n.t('planner.portionsReady', {
                          count: leftoverRemaining(batch.id)
                        })}</small
                      ></span
                    >
                  </button>{/each}
                {#each sourceSessions as session}<button
                    type="button"
                    class="wp-ready-card"
                    onclick={() => chooseSource(session.id)}
                    ><span
                      ><strong>{session.name}</strong><small
                        >{i18n.t('planner.preparedOn', {
                          day: dateLabel(session.day, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short'
                          }),
                          count: remaining(session.id)
                        })}</small
                      ></span
                    ></button
                  >{/each}
                {#if !leftovers.some((b) => leftoverRemaining(b.id) > 0) && !sourceSessions.length}<p
                  >
                    {i18n.t('planner.noPreparedFoodListedForThisDay')}
                  </p>{/if}
                <button
                  type="button"
                  class="wp-secondary"
                  onclick={() => {
                    close(true);
                    newLeftover();
                  }}>{i18n.t('planner.addLeftoversYouAlreadyHave')}</button
                >
              </div>
            {:else}
              {#if modal === 'meal'}
                {#if sourceId || leftoverId}{#if editing}<p class="wp-modal-help">
                      {i18n.t('planner.source', {
                        name:
                          (sourceId
                            ? sessions.find((s) => s.id === sourceId)?.name
                            : plan.batches.find((b) => b.id === leftoverId)?.name) ?? ''
                      })}
                    </p>{/if}
                  <div class="wp-field">
                    {i18n.t('planner.portionsForThisMeal')}<NumberInput
                      label={i18n.t('planner.portionsForThisMeal')}
                      value={sourcePortions}
                      min={0.5}
                      max={sourceId
                        ? remaining(sourceId) + (plan.weekly?.mealSources?.[editing]?.portions ?? 0)
                        : leftoverRemaining(leftoverId) +
                          (plan.weekly?.leftoverSources?.[editing]?.portions ?? 0)}
                      step={0.5}
                      onChange={(value) => {
                        sourcePortions = value;
                      }}
                    />
                  </div>{/if}
                <details class="wp-meal-details">
                  <summary>{i18n.t('planner.notes')}</summary>
                  <label class="wp-field"
                    >{i18n.t('planner.mealNotes')}<textarea
                      bind:value={notes}
                      rows="4"
                      maxlength="10000"></textarea></label
                  >
                </details>
              {:else}
                {#if modal === 'recipe'}<label class="wp-field"
                    >{i18n.t('books.book')}
                    <select bind:value={recipeBookId} disabled={!!editing || recipeSaving} required>
                      {#each catalog.books.filter((b) => b.access !== 'view' || b.id === recipeBookId) as book}<option
                          value={book.id}>{book.name}</option
                        >{/each}
                    </select></label
                  >{/if}
                <div class="wp-field" class:wp-recipe-yield={modal === 'recipe'}>
                  <span class="wp-portions-label"
                    ><Icon name="bowl" size={13} />{i18n.t('planner.portions')}</span
                  ><NumberInput
                    disabled={recipeReadOnly}
                    label={i18n.t('planner.portions')}
                    value={portions}
                    min={0.5}
                    max={999}
                    step={0.5}
                    onChange={(value) => {
                      portions = value;
                    }}
                  />
                  {#if modal === 'recipe' && editing}<button
                      type="button"
                      class="wp-secondary wp-recipe-plan"
                      onclick={async () => {
                        if (!dialog?.querySelector('form')?.reportValidity() || photoBusy) return;
                        const id = currentEntry?.recipe.id;
                        await save();
                        if (!error && modal === null) {
                          const saved = catalog.recipes.find((r) => r.recipe.id === id);
                          openCooking(
                            availableRecipes.find((r) => r.id === (saved && snapshotId(saved)))
                          );
                        }
                      }}><Icon name="plus" size={16} />{i18n.t('planner.planACook')}</button
                    >{/if}
                </div>
                {#if modal === 'recipe' && recipeReadOnly}
                  <ul>
                    {#each recipeIngredients as ingredient}<li>
                        {ingredientLine(ingredient)}
                      </li>{/each}
                  </ul>
                  <p style="white-space: pre-wrap">{notes}</p>
                {:else if modal === 'recipe'}<RecipeIngredients
                    rows={recipeIngredients}
                    bind:pasted={recipePaste}
                    library={cookingPlan.weekly?.ingredientLibrary ?? []}
                    onChange={(rows) => (recipeIngredients = rows)}
                  /><label class="wp-field"
                    ><span class="wp-recipe-section-label">{i18n.t('planner.method')}</span
                    ><textarea
                      use:autoGrow
                      class="wp-method-input"
                      bind:value={notes}
                      rows="4"
                      maxlength="10000"
                      placeholder={i18n.t('planner.writeTheStepsInYourOwnWords')}></textarea></label
                  >{/if}
              {/if}
              {#if error}<p class="wp-alert" role="alert">{error}</p>{/if}
              <footer>
                {#if modal === 'meal' && editing && style === 'easy' && !sourceId && !leftoverId}<button
                    type="button"
                    class="wp-secondary"
                    onclick={duplicateMeal}>{i18n.t('planner.duplicateMeal')}</button
                  >{/if}
                {#if editing && (modal !== 'recipe' || recipeAccess === 'owner')}<button
                    type="button"
                    class="wp-delete"
                    disabled={recipeSaving}
                    onclick={remove}
                    ><Icon name="trash" size={17} />{i18n.t('planner.remove')}</button
                  >{/if}
                {#if modal === 'recipe' && editing && writableBooks.length}<button
                    type="button"
                    class="wp-secondary"
                    disabled={recipeSaving}
                    onclick={async () => {
                      if (
                        draftKey() !== initialDraft &&
                        !(await confirmAction(i18n.t('planner.discardTheseUnsavedEdits')))
                      )
                        return;
                      const source = availableRecipes.find((r) => r.id === editing);
                      if (!source) return;
                      newRecipe(source);
                      editing = '';
                      currentEntry = undefined;
                      recipeBookId = catalog.defaultBookId;
                      await tick();
                      initialDraft = draftKey();
                      dialog?.querySelector<HTMLInputElement>('.wp-header-name')?.focus();
                    }}>{i18n.t('books.copy')}</button
                  >{/if}
                <div>
                  <button
                    type="button"
                    class="wp-secondary"
                    disabled={recipeSaving}
                    onclick={() => close()}>{i18n.t('planner.cancel')}</button
                  >
                  {#if !recipeReadOnly}<button
                      class="wp-primary"
                      disabled={!loaded ||
                        photoBusy ||
                        recipeSaving ||
                        (modal === 'recipe' && !recipeBookId)}>{i18n.t('planner.save')}</button
                    >{/if}
                </div>
              </footer>
            {/if}
          {/if}
          {#if modal === 'meal-choice' || (modal === 'meal' && !editing && style === 'leftovers' && !title)}<footer
            >
              <div>
                <button type="button" class="wp-secondary" onclick={() => close()}
                  >{i18n.t('planner.cancel')}</button
                >
              </div>
            </footer>{/if}
        {/if}
      </form>
    </dialog>
  {/if}

  {#if cooking}<CookingEditor
      plan={cookingPlan}
      recipes={availableRecipes}
      {bookNames}
      week={cooking.day ?? week}
      firstMeal={cooking.firstMeal}
      {preferredPortions}
      session={cooking.session}
      recipe={cooking.recipe}
      onSave={(next, message) => {
        const saved = commit(next, message);

        return saved;
      }}
      onRemove={removeCookingSession}
      onClose={() => (cooking = null)}
    />{/if}

  {#if bookManager}<RecipeBookManager
      {catalog}
      selected={bookFilter}
      onChange={(value) => {
        catalogRequest++;
        catalog = value;
        if (!catalog.books.some((b) => b.id === bookFilter)) bookFilter = '';
      }}
      onClose={() => (bookManager = false)}
    />{/if}
  {#if libraryOpen}<IngredientLibrary
      plan={cookingPlan}
      onSave={commit}
      onClose={() => (libraryOpen = false)}
    />{/if}
{/if}
