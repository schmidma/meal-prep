<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { useI18n } from '$lib/i18n/context.svelte';
  import { setAccountContext } from '$lib/household-client';
  import { bookRequest } from '$lib/recipe-books-client';
  import type { Account } from '$lib/account';
  import WelcomeLayout from '$lib/components/WelcomeLayout.svelte';
  import '$lib/styles/planner.css';
  const i18n = useI18n();
  let account = $state<Account | null>(null);
  let invite = $state<{ name: string; permission: string } | null>(null);
  let error = $state('');
  let busy = $state(false);
  onMount(() => {
    void load();
  });
  async function load() {
    try {
      const response = await fetch('/api/account');
      if (response.status === 401) {
        await goto(`/sign-in?next=${encodeURIComponent(location.pathname)}`, {
          replaceState: true
        });
        return;
      }
      if (!response.ok) throw new Error('Unable to update recipe books.');
      account = await response.json();
      setAccountContext(account!);
      await i18n.loadAccount(account!);
      if (!account?.household) return;
      invite = await bookRequest(
        undefined,
        `?invitation=${encodeURIComponent(page.params.token ?? '')}`
      );
    } catch (cause) {
      error = i18n.error((cause as Error).message);
    }
  }
  async function accept() {
    busy = true;
    try {
      await bookRequest({ action: 'join', value: page.params.token });
      await goto('/?view=recipes');
    } catch (cause) {
      error = i18n.error((cause as Error).message);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>{i18n.t('books.invitation')}</title><meta
    name="referrer"
    content="no-referrer"
  /></svelte:head
>
<WelcomeLayout>
  <h1>{invite?.name ?? i18n.t('books.invitation')}</h1>
  {#if error}<p role="alert" class="wp-alert">{error}</p>{/if}
  {#if account && !account.household}<p>{i18n.t('books.householdFirst')}</p>
    <a class="wp-primary" href={`/household?next=${encodeURIComponent(page.url.pathname)}`}
      >{i18n.t('household.backToYourKitchen')}</a
    >
  {:else if invite && account?.household}
    <p>{i18n.t('books.acceptHint', { name: account.household.name })}</p>
    <p>{i18n.t(invite.permission === 'view' ? 'books.viewHint' : 'books.contributeHint')}</p>
    {#if account.household.role === 'owner'}<button
        class="wp-primary"
        disabled={busy}
        onclick={accept}>{i18n.t('books.accept')}</button
      >
    {:else}<p>{i18n.t('books.ownerAccept')}</p>{/if}
  {/if}
  <a class="wp-secondary" href="/">{i18n.t('household.backToYourKitchen')}</a>
</WelcomeLayout>
