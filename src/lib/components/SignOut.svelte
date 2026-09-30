<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { confirmAction } from '$lib/confirmation';
  import { goto } from '$app/navigation';
  import { authClient } from '$lib/auth-client';
  import { LogOut } from '@lucide/svelte';

  let {
    unsaved = false,
    compact = false,
    disabled = false
  } = $props<{
    unsaved?: boolean;
    compact?: boolean;
    disabled?: boolean;
  }>();
  let busy = $state(false);
  let error = $state('');

  async function signOut() {
    if (busy) return;
    if (
      unsaved &&
      !(await confirmAction(
        i18n.t('sign-out.someChangesHaveNotSavedYetSign'),
        i18n.t('sign-out.signOut'),
        i18n.t('sign-out.unsavedChanges')
      ))
    )
      return;
    busy = true;
    error = '';
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(i18n.t('sign-out.signOutFailed'));
      sessionStorage.clear();
      i18n.clearAccount();
      await goto('/sign-in', { replaceState: true, invalidateAll: true });
    } catch {
      error = i18n.t('sign-out.couldNotSignOutTryAgain');
      busy = false;
    }
  }
</script>

<button
  class={compact ? 'wp-account-signout' : 'wp-secondary wp-signout'}
  disabled={disabled || busy}
  onclick={signOut}
>
  <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
  {busy ? i18n.t('sign-out.signingOut') : i18n.t('sign-out.signOut')}
</button>
{#if error}<p class="wp-signout-error" role="alert">{error}</p>{/if}
