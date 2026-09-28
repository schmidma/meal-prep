<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  type ThemeChoice = 'system' | 'light' | 'dark';
  const key = 'meal-prep:theme:v1';
  let choice = $state<ThemeChoice>('system');
  let media: MediaQueryList;

  function readChoice(): ThemeChoice {
    try {
      const stored = localStorage.getItem(key);
      return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
      return 'system';
    }
  }

  function apply() {
    const theme = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    root.style.backgroundColor = theme === 'dark' ? '#171f1d' : '#f6f7f2';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#171f1d' : '#244c3e');
  }

  onMount(() => {
    media = matchMedia('(prefers-color-scheme: dark)');
    choice = readChoice();
    apply();
    const systemChanged = () => {
      if (choice === 'system') apply();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      choice = readChoice();
      apply();
    };
    media.addEventListener('change', systemChanged);
    window.addEventListener('storage', storageChanged);
    return () => {
      media.removeEventListener('change', systemChanged);
      window.removeEventListener('storage', storageChanged);
    };
  });

  function selectTheme(value: ThemeChoice) {
    choice = value;
    apply();
    try {
      if (value === 'system') localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Keep the choice working in this tab even when storage is blocked.
    }
  }
  const nextChoice = $derived<ThemeChoice>(
    choice === 'system' ? 'light' : choice === 'light' ? 'dark' : 'system'
  );
  const label = $derived(
    `Theme: ${choice[0].toUpperCase()}${choice.slice(1)}. Switch to ${nextChoice} theme`
  );
</script>

<button
  type="button"
  class="icon-button theme-toggle"
  data-theme-choice={choice}
  aria-label={label}
  title={label}
  onclick={() => selectTheme(nextChoice)}
  ><Icon
    name={choice === 'system' ? 'monitor' : choice === 'light' ? 'sun' : 'moon'}
    size={17}
  /></button
>

<style>
  .theme-toggle {
    flex-shrink: 0;
  }
</style>
