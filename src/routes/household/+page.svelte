<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { House } from '@lucide/svelte';
  import WelcomeLayout from '$lib/components/WelcomeLayout.svelte';
  import { goto } from '$app/navigation';
  import { setAccountContext, householdFetch } from '$lib/household-client';
  import { onMount } from 'svelte';
  import SignOut from '$lib/components/SignOut.svelte';
  import '$lib/styles/planner.css';
  let next = '/';
  let name = $state(i18n.t('household.ourKitchen'));
  let email = $state('');
  let busy = $state(false);
  let error = $state('');
  onMount(() => {
    const candidate = new URL(location.href).searchParams.get('next');
    if (candidate && /^\/books\/join\/[a-f0-9]{64}$/.test(candidate)) next = candidate;
    void fetch('/api/account')
      .then(async (r) => {
        if (r.status === 401) {
          await goto('/sign-in', { replaceState: true });
          return;
        }
        if (!r.ok) throw new Error();
        const account = await r.json();
        setAccountContext(account);
        await i18n.loadAccount(account);
        if (account.household) await goto(next, { replaceState: true });
        email = account.user.email;
      })
      .catch(() => (error = i18n.t('planner.unableToLoadYourAccountPleaseReload')));
  });
  async function create() {
    busy = true;
    error = '';
    try {
      const r = await householdFetch('/api/household', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name })
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await goto(next, { replaceState: true, invalidateAll: true });
    } catch (cause) {
      error =
        cause instanceof Error
          ? i18n.error(cause.message)
          : i18n.t('household.unableToCreateHousehold');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{i18n.t('household.yourHouseholdMealPrep')}</title></svelte:head>
<WelcomeLayout>
  <h1>{i18n.t('household.startYourHousehold')}</h1>
  <p>{i18n.t('household.aSharedSpaceForYourRecipesAnd')}</p>
  {#if error}<p role="alert" class="wp-alert">{error}</p>{/if}
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void create();
    }}
  >
    <label
      ><span class="wp-sr-only">{i18n.t('household-settings.householdName')}</span><span
        class="wp-access-input"
        ><House size={18} aria-hidden="true" /><input
          placeholder={i18n.t('household-settings.householdName')}
          bind:value={name}
          maxlength="80"
          required
        /></span
      ></label
    ><button class="wp-primary" disabled={busy || !email}
      >{busy ? i18n.t('household.creating') : i18n.t('household.createHousehold')}</button
    >
  </form>
  <div class="wp-welcome-secondary">
    <p>{i18n.t('household.joiningSomeoneOpenTheInvitationLinkThey')}</p>
    <p class="wp-welcome-account">{email}</p>
    <SignOut disabled={!email || busy} />
  </div>
</WelcomeLayout>
