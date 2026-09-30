<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import { addDays, parseDay, startOfWeek } from '$lib/calendar';
  let {
    value,
    label = i18n.t('day-picker.day'),
    onChange
  }: { value: string; label?: string; onChange: (day: string) => void } = $props();
  const week = $derived(startOfWeek(value));
  const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(week, i)));
  const monthLabel = $derived(
    new Intl.DateTimeFormat(i18n.tag, { month: 'short', year: 'numeric' }).formatRange(
      parseDay(days[0]),
      parseDay(days[6])
    )
  );
  const name = (day: string) =>
    parseDay(day).toLocaleDateString(i18n.tag, {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
</script>

<div class="wp-day-picker" role="group" aria-label={label}>
  <div class="wp-day-picker-heading">
    <strong>{label}</strong><span>{monthLabel}</span>
  </div>
  <div class="wp-day-buttons">
    <button
      type="button"
      class="wp-icon-button"
      aria-label={i18n.t('dates.previousWeek', { label: label.toLowerCase() })}
      onclick={() => onChange(addDays(value, -7))}>‹</button
    >
    {#each days as day}<button
        type="button"
        aria-label={i18n.t('dates.labeledDay', { label, day: name(day) })}
        aria-pressed={day === value}
        onclick={() => onChange(day)}
        ><span>{parseDay(day).toLocaleDateString(i18n.tag, { weekday: 'short' })}</span><strong
          >{parseDay(day).getDate()}</strong
        ></button
      >{/each}
    <button
      type="button"
      class="wp-icon-button"
      aria-label={i18n.t('dates.nextWeek', { label: label.toLowerCase() })}
      onclick={() => onChange(addDays(value, 7))}>›</button
    >
  </div>
  <details class="wp-other-date">
    <summary>{i18n.t('day-picker.anotherDate')}</summary><input
      type="date"
      aria-label={label}
      {value}
      min="0001-01-08"
      max="9999-12-24"
      onchange={(e) => {
        if (e.currentTarget.value) onChange(e.currentTarget.value);
      }}
    />
  </details>
</div>
