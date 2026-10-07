<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import NumberInput from '$lib/components/NumberInput.svelte';
  import { confirmAction } from '$lib/confirmation';
  import { onMount, untrack } from 'svelte';
  import type { CookingSession, KitchenPlan, Recipe } from '$lib/kitchen';
  import {
    servingSlots,
    recipeNotes,
    saveCooking,
    shoppingForBatch,
    type ServingSlot
  } from '$lib/cooking';
  import { newId } from '$lib/id';
  import PhotoPicker from './PhotoPicker.svelte';
  import FoodDialogHeader from './FoodDialogHeader.svelte';
  import Icon from './Icon.svelte';
  import RecipeInput from './RecipeInput.svelte';
  import DayPicker from './DayPicker.svelte';
  let {
    plan,
    recipes = plan.recipes,
    bookNames = {},
    week,
    session,
    recipe,
    firstMeal,
    preferredPortions = 2,
    onSave,
    onRemove,
    onClose
  }: {
    plan: KitchenPlan;
    recipes?: Recipe[];
    bookNames?: Record<string, string>;
    week: string;
    session?: CookingSession;
    recipe?: Recipe;
    firstMeal?: string;
    preferredPortions?: number;
    onSave: (next: KitchenPlan, message: string) => boolean;
    onRemove: (id: string) => Promise<boolean>;
    onClose: () => void;
  } = $props();
  const initial = untrack(() => ({ session, recipe, week, plan, firstMeal, preferredPortions }));
  let selected = $state(initial.recipe?.id ?? initial.session?.recipeId ?? '');
  let name = $state(initial.session?.name ?? initial.recipe?.name ?? '');
  let day = $state(initial.session?.day ?? initial.week);
  let quantity = $state(initial.session?.quantity ?? initial.recipe?.yieldQuantity ?? 4);
  const initialRecipe =
    initial.recipe ?? initial.plan.recipes.find((r) => r.id === initial.session?.recipeId);
  let notes = $state(
    initialRecipe && (!initial.session || initial.session.notes === recipeNotes(initialRecipe))
      ? recipeNotes(initialRecipe, initial.session?.quantity ?? initialRecipe.yieldQuantity)
      : (initial.session?.notes ?? '')
  );
  let image = $state(
    initial.plan.weekly?.images?.[initial.session?.id ?? initial.recipe?.id ?? ''] ?? ''
  );
  let slots = $state<ServingSlot[]>(
    initial.session
      ? servingSlots(initial.plan, initial.session.id)
      : initial.firstMeal
        ? [
            {
              id: newId('meal'),
              day: initial.week,
              slot: initial.firstMeal,
              portions: Math.min(initial.preferredPortions, initial.recipe?.yieldQuantity ?? 4)
            }
          ]
        : []
  );
  let shop = $state(
    Boolean(
      initial.session &&
      initial.plan.weekly?.shopping.some((item) => item.cookId === initial.session!.id)
    )
  );
  let photoBusy = $state(false);
  let photoOpen = $state(false);
  let error = $state('');
  let dialog: HTMLDialogElement;
  const assigned = $derived(slots.reduce((n, slot) => n + (slot.portions || 0), 0));
  const beforeCooking = $derived(slots.some((s) => s.day && s.day < day));
  const chosenRecipe = $derived(plan.recipes.find((r) => r.id === selected));
  const dirtyKey = () =>
    JSON.stringify({ name, day, quantity, notes, image, slots, selected, shop });
  let original = dirtyKey();
  onMount(() => {
    original = dirtyKey();
    dialog.showModal();
    if (!initial.session)
      dialog.querySelector<HTMLInputElement>('.wp-food-dialog-heading input')?.focus();
    return () => dialog?.close();
  });
  async function cancel() {
    if (
      dirtyKey() !== original &&
      !(await confirmAction(i18n.t('cooking-editor.discardThisCookingPlan')))
    )
      return;
    onClose();
  }
  function choose(recipe: Recipe) {
    selected = recipe.id;
    name = recipe.name;
    quantity = recipe.yieldQuantity;
    if (!initial.session)
      slots = slots.map((slot) => ({
        ...slot,
        portions: Math.min(initial.preferredPortions, quantity)
      }));
    notes = recipeNotes(recipe);
    image = plan.weekly?.images?.[recipe.id] ?? '';
    shop = false;
  }
  function changeCookDay(next: string) {
    if (!next) return;
    day = next;
  }
  function changeQuantity(next: number) {
    if (
      chosenRecipe &&
      (notes === recipeNotes(chosenRecipe, quantity) || notes === recipeNotes(chosenRecipe))
    ) {
      notes = recipeNotes(chosenRecipe, next);
    }
    quantity = next;
    if (!initial.session && next > 0)
      slots = slots.map((slot) => ({
        ...slot,
        portions: Math.min(initial.preferredPortions, next)
      }));
  }
  function submit() {
    if (photoBusy) return;
    error = '';
    if (assigned > quantity) {
      error = i18n.t('cooking-editor.increasePortionsOrRemoveAMealIn');
      return;
    }
    if (beforeCooking) {
      error = i18n.t('cooking-editor.chooseACookingDayBeforeYourPlanned');
      return;
    }
    if (!name.trim()) {
      error = i18n.t('cooking-editor.giveThisCookingSessionAName');
      return;
    }
    try {
      const session: CookingSession = {
        id: initial.session?.id ?? newId('cook'),
        name: name.trim(),
        day,
        quantity,
        notes,
        recipeId: selected
      };
      const next = saveCooking(
        plan,
        session,
        slots,
        chosenRecipe ? (plan.weekly?.images?.[chosenRecipe.id] ?? '') : image,
        shop
          ? chosenRecipe
            ? shoppingForBatch(chosenRecipe, quantity)
            : (plan.weekly?.shopping ?? [])
                .filter((item) => item.cookId === initial.session?.id)
                .map((item) => item.name)
          : []
      );
      if (
        onSave(
          next,
          initial.session
            ? i18n.t('cooking-editor.cookingPlanUpdated')
            : slots.length
              ? i18n.t('cooking-editor.cookingAndMealPlanned')
              : i18n.t('cooking-editor.cookingPlannedAddItToAMeal')
        )
      )
        onClose();
    } catch {
      error = i18n.t('cooking-editor.checkTheDatesAndPortionsThenTry');
    }
  }
</script>

<dialog
  class="wp-dialog wp-cooking-dialog wp-food-dialog"
  bind:this={dialog}
  aria-labelledby="cooking-title"
  oncancel={(e) => {
    e.preventDefault();
    cancel();
  }}
  onclick={(e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        cancel();
    }
  }}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <FoodDialogHeader
      title={initial.session
        ? i18n.t('cooking-editor.editCookingPlan')
        : i18n.t('cooking-editor.planCooking')}
      titleId="cooking-title"
      image={chosenRecipe ? (plan.weekly?.images?.[chosenRecipe.id] ?? '') : image}
      editable={!photoOpen && !chosenRecipe}
      onPhoto={() => (photoOpen = !photoOpen)}
    >
      <RecipeInput
        hideLabel
        value={name}
        {recipes}
        {bookNames}
        library={plan.weekly?.ingredientLibrary}
        useSoon={plan.weekly?.useSoon}
        images={plan.weekly?.images}
        label={i18n.t('planner.mealName')}
        onInput={(value) => {
          name = value;
          if (chosenRecipe && value !== chosenRecipe.name) selected = '';
        }}
        onSelect={choose}
      />
    </FoodDialogHeader>
    {#if photoOpen && !chosenRecipe}<PhotoPicker
        value={image}
        onChange={(value) => (image = value)}
        bind:busy={photoBusy}
        onDone={() => (photoOpen = false)}
      />{/if}
    {#if !photoOpen}
      <section class="wp-flow-section" aria-label={i18n.t('cooking-editor.cookingDetails')}>
        {#if !initial.session && plan.weekly?.useSoon?.length}<p class="wp-cook-ingredients">
            <Icon name="leaf" size={14} />{i18n.t('cooking-editor.useSoon')}
            {plan.weekly.useSoon.map((item) => item.name).join(', ')}
          </p>{/if}
        {#if !initial.session}<DayPicker
            value={day}
            label={i18n.t('planner.cookingDay')}
            onChange={changeCookDay}
          />{/if}
        <div class="wp-field wp-portions-field">
          {i18n.t('cooking-editor.makesPortions')}<NumberInput
            label={i18n.t('cooking-editor.makesPortions')}
            value={quantity}
            max={999}
            onChange={changeQuantity}
          />
        </div>
        {#if chosenRecipe?.ingredients.length}<label class="wp-check-row wp-shop-option"
            ><input type="checkbox" bind:checked={shop} />{i18n.t(
              'cooking-editor.addIngredientsToShoppingList'
            )}</label
          >{/if}
        <details class="wp-cook-details">
          <summary>{i18n.t('planner.notes')}</summary>
          <label class="wp-field"
            >{i18n.t('planner.notes')}<textarea bind:value={notes} rows="5" maxlength="10000"
            ></textarea></label
          >
        </details>
      </section>
      {#if beforeCooking}<p class="wp-cook-warning" role="status">
          {i18n.t('cooking-editor.chooseACookingDayOnOrBefore')}
        </p>{/if}
      {#if assigned > quantity}<p class="wp-cook-warning" role="status">
          {i18n.t('cooking.alreadyPlanned', { count: assigned })}
        </p>{/if}
      {#if error}<p class="wp-alert" role="alert">{error}</p>{/if}
      <footer>
        {#if initial.session}<button
            type="button"
            class="wp-delete"
            onclick={async () => {
              if (await onRemove(initial.session!.id)) onClose();
            }}><Icon name="trash" size={17} />{i18n.t('planner.remove')}</button
          >{/if}
        <div>
          <button type="button" class="wp-secondary" onclick={cancel}
            >{i18n.t('planner.cancel')}</button
          >
          <button class="wp-primary" disabled={photoBusy || beforeCooking || assigned > quantity}
            >{i18n.t('planner.save')}</button
          >
        </div>
      </footer>
    {/if}
  </form>
</dialog>
