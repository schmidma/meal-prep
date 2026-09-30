<script lang="ts">
  import { onMount } from 'svelte';
  import { useI18n } from '$lib/i18n/context.svelte';
  import { isLocale, languages } from '$lib/i18n/messages';
  let { compact = false } = $props<{ compact?: boolean }>();
  const i18n = useI18n();
  const id = $props.id();
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
  let busy = $state(false);
  let error = $state('');
</script>

<div class="wp-language" class:compact>
  <div class="language-row">
    <label for={id}>{i18n.t('language.label')}</label>
    <select
      {id}
      value={i18n.locale}
      disabled={!ready || busy}
      onchange={async (event) => {
        const select = event.currentTarget;
        const value = select.value;
        if (!isLocale(value)) return;
        busy = true;
        error = '';
        try {
          await i18n.setLocale(value);
        } catch {
          error = i18n.t('language.saveFailed');
        } finally {
          busy = false;
          select.value = i18n.locale;
        }
      }}
    >
      {#each Object.entries(languages) as [locale, language]}
        <option value={locale} lang={locale}>{language.name}</option>
      {/each}
    </select>
  </div>
  {#if !compact}<p>{i18n.t('language.personal')}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
</div>

<style>
  .wp-language {
    margin: 0 0 24px;
    color: #283e33;
  }
  .language-row {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 14px;
    font-weight: 550;
  }
  select {
    min-height: 44px;
    padding: 8px 32px 8px 12px;
    background: white;
    border: 1px solid #d9e0d0;
    border-radius: 8px;
    color: inherit;
  }
  p {
    font-size: 13px;
    color: #6b756e;
    margin: 8px 0 0;
  }
  .compact {
    margin: 24px auto 0;
  }
  .compact .language-row {
    justify-content: center;
    font-size: 12px;
  }
</style>
