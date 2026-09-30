<script lang="ts">
  import { useI18n } from '$lib/i18n/context.svelte';
  const i18n = useI18n();
  import LanguagePicker from './LanguagePicker.svelte';
  import NumberInput from '$lib/components/NumberInput.svelte';
  import { newId } from '$lib/id';
  import type { PlanningSettings } from '$lib/planning-settings';
  import Icon from './Icon.svelte';
  let {
    value,
    onchange
  }: { value: PlanningSettings; onchange: (value: PlanningSettings) => boolean } = $props();
  let custom = $state('');
  function section(id: string, patch: { name?: string; enabled?: boolean }) {
    return onchange({
      ...value,
      sections: value.sections.map((s) => (s.id === id ? { ...s, ...patch } : s))
    });
  }
  function move(index: number, offset: number) {
    const sections = [...value.sections];
    [sections[index], sections[index + offset]] = [sections[index + offset], sections[index]];
    onchange({ ...value, sections });
  }
</script>

<section class="wp-intro">
  <div>
    <h1>{i18n.t('planner.settings')}</h1>
    <p>{i18n.t('planning-settings.sharedWithYourHouseholdChangesSaveAutomatically')}</p>
  </div>
</section>
<LanguagePicker />
<div class="wp-settings">
  <section>
    <h2>{i18n.t('planning-settings.planningView')}</h2>
    <label
      >{i18n.t('planning-settings.startPlanningFrom')}<select
        value={value.startDay}
        onchange={(e) =>
          onchange({
            ...value,
            startDay: e.currentTarget.value === 'today' ? 'today' : Number(e.currentTarget.value)
          })}
      >
        <option value="today">{i18n.t('planner.today')}</option>
        {#each [i18n.t('planning-settings.sunday'), i18n.t('planning-settings.monday'), i18n.t('planning-settings.tuesday'), i18n.t('planning-settings.wednesday'), i18n.t('planning-settings.thursday'), i18n.t('planning-settings.friday'), i18n.t('planning-settings.saturday')] as day, index}<option
            value={index}>{day}</option
          >{/each}
      </select></label
    >
    <div class="wp-setting-number">
      {i18n.t('planning-settings.daysToShow')}<NumberInput
        label={i18n.t('planning-settings.daysToShow')}
        value={value.daysShown}
        onChange={(daysShown) => onchange({ ...value, daysShown })}
      />
    </div>
    <div class="wp-setting-number">
      {i18n.t('planning-settings.portionsPerMeal')}<NumberInput
        label={i18n.t('planning-settings.portionsPerMeal')}
        value={value.portions}
        min={0.5}
        max={999}
        step={0.5}
        onChange={(portions) => onchange({ ...value, portions })}
      />
    </div>
  </section>
  <section>
    <h2>{i18n.t('planning-settings.mealSections')}</h2>
    <p>
      {i18n.t('planning-settings.chooseWhatAppearsInYourAgendaExisting')}
    </p>
    {#each value.sections as item, index (item.id)}
      <div class="wp-setting-section">
        <label class="wp-section-toggle">
          <input
            type="checkbox"
            aria-label={i18n.t('settings.showSection', { name: i18n.section(item) })}
            checked={item.enabled}
            onchange={(e) => {
              if (
                !onchange({
                  ...value,
                  sections: value.sections.map((s) =>
                    s.id === item.id ? { ...s, enabled: e.currentTarget.checked } : s
                  )
                })
              )
                e.currentTarget.checked = item.enabled;
            }}
          />
        </label>
        <input
          aria-label={i18n.t('settings.sectionName', { name: i18n.section(item) })}
          value={i18n.section(item)}
          maxlength="60"
          onchange={(e) => {
            if (!section(item.id, { name: e.currentTarget.value.trim() }))
              e.currentTarget.value = i18n.section(item);
          }}
        />
        <button
          class="wp-icon-button"
          aria-label={i18n.t('settings.moveUp', { name: i18n.section(item) })}
          disabled={index === 0}
          onclick={() => move(index, -1)}
          ><span style="display:flex;transform:rotate(-90deg)"><Icon name="arrow" size={16} /></span
          ></button
        >
        <button
          class="wp-icon-button"
          aria-label={i18n.t('settings.moveDown', { name: i18n.section(item) })}
          disabled={index === value.sections.length - 1}
          onclick={() => move(index, 1)}
          ><span style="display:flex;transform:rotate(90deg)"><Icon name="arrow" size={16} /></span
          ></button
        >
      </div>
    {/each}
    <form
      class="wp-inline-add"
      onsubmit={(e) => {
        e.preventDefault();
        if (
          onchange({
            ...value,
            sections: [
              ...value.sections,
              { id: newId('section'), name: custom.trim(), enabled: true }
            ]
          })
        )
          custom = '';
      }}
    >
      <input
        aria-label={i18n.t('planning-settings.customSectionName')}
        placeholder={i18n.t('planning-settings.addASectionEgTeatime')}
        maxlength="60"
        bind:value={custom}
      /><button aria-label={i18n.t('planning-settings.addSection')} disabled={!custom.trim()}
        ><Icon name="plus" /></button
      >
    </form>
  </section>
</div>
