<script lang="ts">
  import '../app.css';
  import { untrack } from 'svelte';
  import ConfirmationDialog from '$lib/components/ConfirmationDialog.svelte';
  import { provideI18n } from '$lib/i18n/context.svelte';
  let { children, data } = $props();
  const i18n = provideI18n(untrack(() => data.locale));
  $effect(() => {
    document.documentElement.lang = i18n.locale;
  });
</script>

{@render children()}

<ConfirmationDialog />
