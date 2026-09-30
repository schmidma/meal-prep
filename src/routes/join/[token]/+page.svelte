<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import WelcomeLayout from '$lib/components/WelcomeLayout.svelte';
  import { goto } from '$app/navigation';
  import { setAccountContext, householdFetch } from '$lib/household-client';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import '$lib/styles/planner.css';
  let ready = $state(false);
  let busy = $state(false);
  let error = $state('');
  let existing = $state('');
  let householdName = $state('');
  onMount(() => {
    void fetch('/api/account')
      .then(async (r) => {
        if (r.status === 401) {
          await goto(`/sign-in?next=${encodeURIComponent(location.pathname)}`, {
            replaceState: true
          });
          return;
        }
        if (!r.ok) throw new Error();
        const a = await r.json();
        setAccountContext(a);
        await i18n.loadAccount(a);
        existing = a.household?.name ?? '';
        if (!existing) {
          const response = await fetch(
            `/api/household?invitation=${encodeURIComponent(page.params.token ?? '')}`
          );
          const invitation = await response.json();
          if (!response.ok) {
            error = i18n.error(invitation.error);
            return;
          }
          householdName = invitation.name;
        }
        ready = true;
      })
      .catch(() => (error = i18n.t('planner.unableToLoadYourAccountPleaseReload')));
  });
  async function join() {
    busy = true;
    error = '';
    try {
      const r = await householdFetch('/api/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', token: page.params.token })
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await goto('/', { replaceState: true, invalidateAll: true });
    } catch (cause) {
      error =
        cause instanceof Error
          ? i18n.error(cause.message)
          : i18n.t('household.unableToJoinHousehold');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>{i18n.t('household.joinAHouseholdMealPrep')}</title><meta
    name="referrer"
    content="no-referrer"
  /></svelte:head
>
<WelcomeLayout>
  <h1>
    {householdName
      ? i18n.t('household.joinNamed', { name: householdName })
      : i18n.t('household.joinAHousehold')}
  </h1>
  {#if error}<p role="alert" class="wp-alert">{error}</p>{/if}{#if existing}<p>
      {i18n.t('household.alreadyMember', { name: existing })}
    </p>
    <a class="wp-secondary" href="/">{i18n.t('household.backToYourKitchen')}</a>{:else}<p>
      {i18n.t('household.shareRecipesMealsAndShoppingInOne')}
    </p>
    <button class="wp-primary" disabled={!ready || busy} onclick={join}
      >{busy ? i18n.t('household.joining') : i18n.t('household.acceptInvitation')}</button
    >{/if}
</WelcomeLayout>
