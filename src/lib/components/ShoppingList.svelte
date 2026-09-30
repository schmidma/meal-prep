<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  import type { KitchenPlan, CookingSession } from '$lib/kitchen';
  import { extras } from '$lib/planner';
  import { parseDay } from '$lib/calendar';
  import Icon from './Icon.svelte';
  import IngredientInput from './IngredientInput.svelte';
  const i18n = useI18n();
  let {
    plan,
    loaded,
    commit,
    onAdd,
    shopText = $bindable(''),
    editingShop = $bindable(''),
    editedShopText = $bindable('')
  } = $props<{
    plan: KitchenPlan;
    loaded: boolean;
    commit: (next: KitchenPlan, message?: string) => boolean;
    onAdd: (names: string[]) => boolean;
    shopText?: string;
    editingShop?: string;
    editedShopText?: string;
  }>();
  const shopping = $derived(extras(plan).shopping);
  const sessions: CookingSession[] = $derived(plan.weekly?.sessions ?? []);
  const dateLabel = (day: string, options: Intl.DateTimeFormatOptions) =>
    i18n.date(parseDay(day), options);
  function toggleShopping(id: string) {
    commit({
      ...plan,
      weekly: {
        ...extras(plan),
        shopping: shopping.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i))
      }
    });
  }
  function saveShoppingEdit() {
    const name = editedShopText.trim();
    if (!name) return;
    if (
      commit(
        {
          ...plan,
          weekly: {
            ...extras(plan),
            shopping: shopping.map((item) =>
              item.id === editingShop
                ? {
                    ...item,
                    name,
                    ingredientId: undefined,
                    checked: item.name === name ? item.checked : false
                  }
                : item
            )
          }
        },
        i18n.t('planner.shoppingItemUpdated')
      )
    )
      editingShop = '';
  }
</script>

<section class="wp-intro wp-shopping-heading">
  <div>
    <h1>{i18n.t('planner.shoppingList')}</h1>
    <p>
      {i18n.t('shopping.summary', { count: shopping.filter((i) => !i.checked).length })}
    </p>
  </div>
  {#if shopping.some((i) => i.checked)}<button
      class="wp-secondary"
      onclick={() =>
        commit(
          {
            ...plan,
            weekly: { ...extras(plan), shopping: shopping.filter((i) => !i.checked) }
          },
          i18n.t('planner.checkedItemsCleared')
        )}>{i18n.t('planner.clearChecked')}</button
    >{/if}
</section>
<section class="wp-shopping-panel">
  <form
    class="wp-inline-add"
    onsubmit={(e) => {
      e.preventDefault();
      if (onAdd([shopText])) shopText = '';
    }}
  >
    <IngredientInput
      value={shopText}
      library={plan.weekly?.ingredientLibrary ?? []}
      label={i18n.t('common.shoppingItem')}
      amounts
      onInput={(value) => (shopText = value)}
    /><button aria-label={i18n.t('planner.addShoppingItem')} disabled={!loaded || !shopText.trim()}
      ><Icon name="plus" /></button
    >
  </form>
  {#each shopping as item (item.id)}<div
      class="wp-shopping-row wp-stable-shopping"
      class:wp-checked={item.checked}
    >
      <input
        id={`check-${item.id}`}
        type="checkbox"
        checked={item.checked}
        aria-label={item.name}
        onchange={() => toggleShopping(item.id)}
      />
      <div class="wp-shopping-text">
        {#if editingShop === item.id}<form
            id={`edit-${item.id}`}
            onsubmit={(e) => {
              e.preventDefault();
              saveShoppingEdit();
            }}
          >
            <input
              aria-label={i18n.t('planner.editShoppingItem')}
              bind:value={editedShopText}
              maxlength="200"
              required
            />
          </form>
        {:else}<label for={`check-${item.id}`} title={item.name}>{item.name}</label>{/if}
        {#if item.cookId}{@const source = sessions.find(
            (s) => s.id === item.cookId
          )}{#if source}<small class="wp-shopping-origin"
              >{source.name} · {dateLabel(source.day, {
                weekday: 'short',
                day: 'numeric',
                month: 'short'
              })}</small
            >{/if}{/if}
      </div>
      {#if editingShop === item.id}
        <button
          class="wp-icon-button"
          form={`edit-${item.id}`}
          type="submit"
          aria-label={i18n.t('planner.saveShoppingEdit')}
          disabled={!editedShopText.trim()}><Icon name="check" size={17} /></button
        >
        <button
          class="wp-icon-button"
          aria-label={i18n.t('planner.cancelShoppingEdit')}
          onclick={() => (editingShop = '')}><Icon name="close" size={17} /></button
        >
      {:else}
        <button
          class="wp-icon-button"
          aria-label={i18n.t('shopping.editNamed', { name: item.name })}
          onclick={() => {
            editingShop = item.id;
            editedShopText = item.name;
          }}><Icon name="edit" size={17} /></button
        >
        <button
          class="wp-icon-button"
          aria-label={i18n.t('shopping.removeNamed', { name: item.name })}
          onclick={() =>
            commit(
              {
                ...plan,
                weekly: {
                  ...extras(plan),
                  shopping: shopping.filter((i) => i.id !== item.id)
                }
              },
              i18n.t('planner.itemRemoved')
            )}><Icon name="close" size={17} /></button
        >
      {/if}
    </div>{:else}<div class="wp-large-empty">
      <Icon name="check" size={36} />
      <h2>{i18n.t('planner.aFreshList')}</h2>
      <p>{i18n.t('planner.addAFewThingsAboveOrAdd')}</p>
    </div>{/each}
</section>
