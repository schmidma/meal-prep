<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { Minus, Plus } from '@lucide/svelte';
  let {
    value,
    label,
    disabled = false,
    min = 1,
    max = Infinity,
    step = 1,
    onChange
  }: {
    value: number;
    label: string;
    disabled?: boolean;
    min?: number;
    max?: number;
    step?: number;
    onChange: (value: number) => boolean | void;
  } = $props();
  let input: HTMLInputElement;
  function change(next: number) {
    if (!Number.isFinite(next) || next < min || next > max) return false;
    return onChange(next) !== false;
  }
  function adjust(direction: number) {
    change(Math.min(max, Math.max(min, Number((value + direction * step).toFixed(6)))));
  }
</script>

<span class="wp-number-control">
  <button
    type="button"
    aria-label={i18n.t('numbers.decrease', { label: label.toLowerCase() })}
    disabled={disabled || value <= min}
    onclick={() => adjust(-1)}><Minus size={16} aria-hidden="true" /></button
  >
  <input
    {disabled}
    bind:this={input}
    type="number"
    lang={i18n.tag}
    aria-label={label}
    {value}
    {min}
    max={Number.isFinite(max) ? max : undefined}
    {step}
    required
    oninput={() => {
      if (input.valueAsNumber > max && change(max)) input.value = String(max);
      else if (input.validity.valid) change(input.valueAsNumber);
    }}
    onblur={() => {
      input.value = String(value);
    }}
  />
  <button
    type="button"
    aria-label={i18n.t('numbers.increase', { label: label.toLowerCase() })}
    disabled={disabled || value >= max}
    onclick={() => adjust(1)}><Plus size={16} aria-hidden="true" /></button
  >
</span>
