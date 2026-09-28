<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { addMinutes, formatTime, parseDay, parseTime } from '$lib/calendar';
  import { MAX_ACTIVITY_MINUTES, type LocalTime } from '$lib/domain';
  import type { Recipe } from '$lib/kitchen';
  import { dateLabel } from '$lib/view';
  import { PX_PER_MINUTE } from '$lib/time-layout';
  import Popover from './Popover.svelte';
  import Icon from './Icon.svelte';
  export type QuickKind = 'cook' | 'meal' | 'block' | 'other';
  let {
    start,
    initialKind = 'cook',
    duration = 45,
    durationProvided = false,
    editableStart = false,
    onstartchange,
    recipes,
    anchor,
    oncreate,
    onpreview,
    onclose
  }: {
    start: LocalTime;
    initialKind?: QuickKind;
    duration?: number;
    durationProvided?: boolean;
    editableStart?: boolean;
    onstartchange?: (start: LocalTime) => void;
    recipes: Recipe[];
    anchor?: HTMLElement | null;
    oncreate: (
      title: string,
      kind: QuickKind,
      duration: number,
      recipe?: { id: string; yieldQuantity: number }
    ) => void;
    onpreview?: (title: string, kind: QuickKind, duration: number) => void;
    onclose: () => void;
  } = $props();
  let kind = $state<QuickKind>(untrack(() => initialKind));
  let title = $state('');
  const suppliedDuration = untrack(() => duration);
  let localDuration = $state(suppliedDuration);
  let durationEdited = $state(false);
  let draftDay = $state(untrack(() => start.day));
  let draftTime = $state(untrack(() => formatTime(start.minute)));
  let timeError = $state('');
  function updateStart() {
    try {
      parseDay(draftDay);
      const minute = parseTime(draftTime);
      if (draftDay < '0001-01-01' || draftDay > '9999-12-31') throw new Error();
      onstartchange?.({ day: draftDay, minute });
      timeError = '';
    } catch {
      timeError = 'Enter a valid date and time.';
    }
  }
  let recipeId = $state('');
  let yieldQuantity = $state(4);
  let suggestionsOpen = $state(false);
  let activeIndex = $state(-1);
  let composing = $state(false);
  let selectingByPointer = false;
  let touchStartY = 0;
  let touchMoved = false;
  let nameInput: HTMLInputElement;
  function finishPointer() {
    setTimeout(() => {
      selectingByPointer = false;
      if (document.activeElement !== nameInput) {
        suggestionsOpen = false;
        activeIndex = -1;
      }
    }, 0);
  }
  const suggestionsId = $props.id();
  const matches = $derived(
    kind === 'cook' && recipes.length
      ? recipes.filter((recipe) =>
          recipe.name.toLocaleLowerCase().includes(title.toLocaleLowerCase())
        )
      : []
  );
  const selectedRecipe = $derived(recipes.find((recipe) => recipe.id === recipeId));
  function removeRecipe() {
    recipeId = '';
    if (!durationEdited) localDuration = suppliedDuration;
  }
  function chooseKind(next: QuickKind) {
    kind = next;
    suggestionsOpen = false;
    activeIndex = -1;
    if (next !== 'cook') removeRecipe();
  }
  function chooseRecipe(id: string) {
    const recipe = recipes.find((item) => item.id === id);
    if (!recipe) return;
    recipeId = id;
    if (!durationEdited)
      localDuration = !durationProvided ? recipe.durationMinutes : suppliedDuration;
    title = recipe.name;
    yieldQuantity = recipe.yieldQuantity;
    suggestionsOpen = false;
    activeIndex = -1;
    selectingByPointer = false;
    if (document.activeElement !== nameInput) nameInput.focus();
    suggestionsOpen = false;
  }
  function nameKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      selectingByPointer = false;
      suggestionsOpen = false;
      activeIndex = -1;
    }
    if (event.isComposing || composing || event.keyCode === 229) {
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && suggestionsOpen) {
      event.preventDefault();
      event.stopPropagation();
      suggestionsOpen = false;
      activeIndex = -1;
    } else if (
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      kind === 'cook' &&
      matches.length &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      activeIndex =
        !suggestionsOpen || activeIndex < 0
          ? event.key === 'ArrowDown'
            ? 0
            : matches.length - 1
          : event.key === 'ArrowDown'
            ? (activeIndex + 1) % matches.length
            : (activeIndex + matches.length - 1) % matches.length;
      suggestionsOpen = true;
      const index = activeIndex,
        query = title;
      void tick().then(() => {
        if (!nameInput?.isConnected || !suggestionsOpen || title !== query || activeIndex !== index)
          return;
        const option = document.getElementById(`${suggestionsId}-${index}`);
        const list = option?.parentElement;
        if (!option || !list) return;
        const rect = option.getBoundingClientRect(),
          bounds = list.getBoundingClientRect();
        if (rect.top < bounds.top) list.scrollTop += rect.top - bounds.top;
        else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
      });
    } else if (
      event.key === 'Enter' &&
      suggestionsOpen &&
      activeIndex >= 0 &&
      matches[activeIndex]
    ) {
      event.preventDefault();
      chooseRecipe(matches[activeIndex].id);
    }
  }
  $effect(() => {
    const nextTitle = title.trim();
    const nextKind = kind;
    const nextDuration = localDuration;
    untrack(() => onpreview?.(nextTitle, nextKind, nextDuration));
  });
  function point() {
    if (!anchor?.classList.contains('empty-calendar')) return undefined;
    const rect = anchor.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + start.minute * PX_PER_MINUTE };
  }
</script>

<!-- Touch compatibility clicks can arrive in a later task than pointerup. Keep the
     list geometry until activation itself, not a guessed release delay. -->
<svelte:window
  onclick={finishPointer}
  onpointercancel={() => {
    selectingByPointer = false;
  }}
/>

<Popover {anchor} {point} label="Quick add" compact {onclose}>
  <p class="popover-eyebrow">{dateLabel(start.day)} / {formatTime(start.minute)}</p>
  <form
    onpointerdowncapture={() => {
      selectingByPointer = true;
    }}
    onsubmit={(event) => {
      event.preventDefault();
      if (!title.trim()) return;
      try {
        if (editableStart) {
          parseDay(draftDay);
          const minute = parseTime(draftTime);
          if (draftDay < '0001-01-01' || draftDay > '9999-12-31') throw new Error();
          addMinutes({ day: draftDay, minute }, localDuration);
          onstartchange?.({ day: draftDay, minute });
        }
        if (
          !Number.isFinite(localDuration) ||
          localDuration < 0 ||
          localDuration > MAX_ACTIVITY_MINUTES
        )
          throw new Error();
      } catch {
        timeError = 'Choose a valid duration and a time range within years 1-9999.';
        return;
      }
      if (recipeId && kind === 'cook') {
        if (!Number.isFinite(yieldQuantity) || yieldQuantity <= 0) return;
        if (!recipes.some((recipe) => recipe.id === recipeId)) return;
        oncreate(title.trim(), kind, localDuration, { id: recipeId, yieldQuantity });
      } else oncreate(title.trim(), kind, localDuration);
    }}
  >
    <input
      class="quick-title"
      aria-label="Activity name"
      role={kind === 'cook' && recipes.length ? 'combobox' : undefined}
      aria-autocomplete={kind === 'cook' && recipes.length ? 'list' : undefined}
      aria-expanded={kind === 'cook' && recipes.length ? suggestionsOpen : undefined}
      aria-controls={kind === 'cook' && recipes.length && suggestionsOpen
        ? suggestionsId
        : undefined}
      aria-activedescendant={suggestionsOpen && activeIndex >= 0 && matches[activeIndex]
        ? `${suggestionsId}-${activeIndex}`
        : undefined}
      placeholder={kind === 'block' ? 'Climbing, an evening out...' : 'What are you planning?'}
      required
      maxlength="100"
      bind:value={title}
      bind:this={nameInput}
      onfocus={() => {
        if (kind === 'cook' && recipes.length) suggestionsOpen = true;
      }}
      oninput={() => {
        suggestionsOpen = kind === 'cook' && recipes.length > 0;
        activeIndex = -1;
      }}
      onblur={() => {
        if (!selectingByPointer) {
          suggestionsOpen = false;
          activeIndex = -1;
        }
      }}
      oncompositionstart={() => {
        composing = true;
      }}
      oncompositionend={() => {
        composing = false;
      }}
      onkeydown={nameKeydown}
      data-autofocus
    />
    {#if kind === 'cook' && recipes.length && suggestionsOpen}
      <div class="recipe-suggestions" id={suggestionsId} role="listbox" aria-label="Recipes">
        {#each matches as recipe, index (recipe.id)}
          <div
            role="option"
            tabindex="-1"
            id={`${suggestionsId}-${index}`}
            aria-labelledby={`${suggestionsId}-${index}-name`}
            aria-describedby={`${suggestionsId}-${index}-details`}
            aria-selected={activeIndex === index}
            class:active={activeIndex === index}
            onpointerdown={(event) => {
              selectingByPointer = true;
              if (event.pointerType === 'mouse') event.preventDefault();
            }}
            onpointercancel={() => {
              selectingByPointer = false;
            }}
            ontouchstart={(event) => {
              touchStartY = event.touches[0].clientY;
              touchMoved = false;
            }}
            ontouchmove={(event) => {
              if (Math.abs(event.touches[0].clientY - touchStartY) > 8) touchMoved = true;
            }}
            ontouchend={(event) => {
              if (touchMoved) return;
              event.preventDefault();
              chooseRecipe(recipe.id);
            }}
            onclick={() => chooseRecipe(recipe.id)}
            onkeydown={(event) => {
              if (event.key === 'Enter') chooseRecipe(recipe.id);
            }}
          >
            <span id={`${suggestionsId}-${index}-name`}>{recipe.name}</span><small
              id={`${suggestionsId}-${index}-details`}
              >Makes {recipe.yieldQuantity} / {recipe.durationMinutes} min</small
            >
          </div>
        {/each}
      </div>
    {/if}
    <div class="template-pills" aria-label="Starting point">
      <button type="button" class:active={kind === 'cook'} onclick={() => chooseKind('cook')}
        ><Icon name="bowl" size={13} /> Cook</button
      >
      <button type="button" class:active={kind === 'meal'} onclick={() => chooseKind('meal')}
        ><Icon name="sun" size={13} /> Eat</button
      >
      <button type="button" class:active={kind === 'block'} onclick={() => chooseKind('block')}
        ><Icon name="clock" size={13} /> Block</button
      >
      <button type="button" class:active={kind === 'other'} onclick={() => chooseKind('other')}
        >Anything</button
      >
    </div>
    {#if kind === 'cook' && selectedRecipe}
      <div class="chosen-recipe">
        <span>Recipe: {selectedRecipe.name}</span>
        <button type="button" aria-label="Remove recipe" onclick={removeRecipe}
          >Remove recipe</button
        >
      </div>
      <label class="field"
        >Make
        <input
          aria-label="Make quantity"
          type="number"
          min="0.001"
          step="any"
          required
          bind:value={yieldQuantity}
        />
      </label>
    {/if}
    {#if editableStart}
      <div class="quick-schedule">
        <label class="field"
          >Date<input
            type="date"
            aria-label="Activity date"
            min="0001-01-01"
            max="9999-12-31"
            required
            bind:value={draftDay}
            oninput={(event) => {
              draftDay = event.currentTarget.value;
              updateStart();
            }}
          /></label
        >
        <label class="field"
          >Time<input
            type="time"
            aria-label="Activity time"
            required
            bind:value={draftTime}
            oninput={(event) => {
              draftTime = event.currentTarget.value;
              updateStart();
            }}
          /></label
        >
        <label class="field"
          >Minutes<input
            type="number"
            aria-label="Duration minutes"
            min="0"
            max={MAX_ACTIVITY_MINUTES}
            required
            bind:value={localDuration}
            oninput={() => {
              durationEdited = true;
              timeError = '';
            }}
          /></label
        >
      </div>
    {:else}<p class="quiet small">{localDuration} minutes. Adjust on the card.</p>{/if}
    {#if timeError}<p class="inline-warning" role="alert">{timeError}</p>{/if}
    <button class="primary-button quick-submit" type="submit"
      >Add to plan <span class="key-hint">Enter</span></button
    >
  </form>
</Popover>
