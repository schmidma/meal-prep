<script lang="ts">
  import LanguagePicker from './LanguagePicker.svelte';
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="wp-welcome-decoration wp-welcome-herbs" aria-hidden="true"></div>
<div class="wp-welcome-decoration wp-welcome-board" aria-hidden="true"></div>
<main class="wp-access wp-welcome">
  <a href="/" class="wp-brand">
    <img class="wp-brand-logo" src="/images/brand/cat-chef.svg" alt="" width="112" height="133" />
    <span>Meal Prep<span class="wp-brand-dot">.</span></span>
  </a>
  <section class="wp-access-card">
    {@render children()}
  </section>
  <LanguagePicker compact />
</main>
