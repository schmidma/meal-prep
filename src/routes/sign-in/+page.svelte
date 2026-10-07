<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import WelcomeLayout from '$lib/components/WelcomeLayout.svelte';
  import { Mail } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { authClient } from '$lib/auth-client';
  import '$lib/styles/planner.css';
  let email = $state('');
  let code = $state('');
  let sent = $state(false);
  let busy = $state(false);
  let error = $state('');
  let next = $state('/');
  let cooldown = $state(0);
  onMount(() => {
    const candidate = new URL(location.href).searchParams.get('next');
    if (candidate && /^\/(?:join|books\/join)\/[a-f0-9]{64}$/.test(candidate)) next = candidate;
    const timer = setInterval(() => {
      if (cooldown > 0) cooldown--;
    }, 1000);
    return () => clearInterval(timer);
  });
  async function send() {
    if (busy || cooldown) return;
    busy = true;
    error = '';
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: 'sign-in'
      });
      if (result.error)
        throw new Error(result.error.message || i18n.t('auth.couldNotSendACodeTryAgain'));
      sent = true;
      cooldown = 60;
    } catch (cause) {
      error = cause instanceof Error ? i18n.error(cause.message) : i18n.t('auth.couldNotSendACode');
    } finally {
      busy = false;
    }
  }
  async function verify() {
    busy = true;
    error = '';
    try {
      const result = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
      if (result.error)
        throw new Error(result.error.message || i18n.t('auth.checkYourCodeAndTryAgain'));
      await goto(next, { replaceState: true, invalidateAll: true });
    } catch (cause) {
      error = cause instanceof Error ? i18n.error(cause.message) : i18n.t('auth.couldNotSignIn');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>{i18n.t('auth.signInMealPrep')}</title><meta
    name="referrer"
    content="no-referrer"
  /></svelte:head
>
<WelcomeLayout>
  <h1>{sent ? i18n.t('auth.checkYourEmail') : i18n.t('auth.signIn')}</h1>
  <p>
    {sent ? i18n.t('auth.codeSent', { email }) : i18n.t('auth.wellEmailYouACodeNoPassword')}
  </p>
  {#if error}<p role="alert" class="wp-alert">{error}</p>{/if}
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void (sent ? verify() : send());
    }}
  >
    {#if !sent}<label
        ><span class="wp-sr-only">{i18n.t('auth.email')}</span><span class="wp-access-input"
          ><Mail size={18} aria-hidden="true" /><input
            type="email"
            placeholder={i18n.t('auth.emailAddress')}
            autocomplete="email"
            required
            bind:value={email}
            disabled={busy}
          /></span
        ></label
      >
    {:else}<label
        >{i18n.t('auth.signinCode')}<input
          aria-label={i18n.t('auth.signinCode')}
          autocomplete="one-time-code"
          inputmode="numeric"
          pattern={'[0-9]{6}'}
          maxlength="6"
          required
          bind:value={code}
          disabled={busy}
        /></label
      >{/if}
    <button class="wp-primary" disabled={busy}
      >{busy
        ? i18n.t('auth.pleaseWait')
        : sent
          ? i18n.t('auth.signIn')
          : i18n.t('auth.sendCode')}</button
    >
  </form>
  {#if sent}<div class="wp-access-actions">
      <button class="wp-secondary wp-resend-code" disabled={busy || cooldown > 0} onclick={send}
        >{cooldown
          ? i18n.t('auth.resendCountdown', { seconds: cooldown })
          : i18n.t('auth.resendCode')}</button
      ><button
        class="wp-secondary"
        disabled={busy}
        onclick={() => {
          sent = false;
          code = '';
          error = '';
          cooldown = 0;
        }}>{i18n.t('auth.changeEmail')}</button
      >
    </div>{/if}
</WelcomeLayout>
