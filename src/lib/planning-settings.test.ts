import { describe, it, expect } from 'vitest';
import {
  planningSettings,
  planningStart,
  validateSettings,
  visibleSections
} from './planning-settings';
import { emptyKitchen, mealSlot } from './planner';
import { parseKitchenPlan } from './plan-document';

describe('planning settings', () => {
  it('defaults to lunch and dinner and anchors a weekday or today', () => {
    const settings = planningSettings(emptyKitchen());
    expect(settings.sections.filter((s) => s.enabled).map((s) => s.name)).toEqual([
      'Lunch',
      'Dinner'
    ]);
    expect(planningStart('2026-09-29', settings)).toBe('2026-09-28');
    expect(planningStart('2026-09-29', { ...settings, startDay: 'today' })).toBe('2026-09-29');
    expect(planningStart('2026-09-29', { ...settings, startDay: 5 })).toBe('2026-09-25');
  });
  it('accepts arbitrary whole day counts and rejects invalid settings', () => {
    const settings = planningSettings(emptyKitchen());
    for (const daysShown of [1, 5, 10, 21, 90])
      expect(() => validateSettings({ ...settings, daysShown })).not.toThrow();
    for (const daysShown of [0, -1, 2.5, Infinity])
      expect(() => validateSettings({ ...settings, daysShown })).toThrow();
    expect(() =>
      validateSettings({
        ...settings,
        sections: settings.sections.map((s) => ({ ...s, enabled: false }))
      })
    ).toThrow();
  });
  it('round trips stable section identity after renaming and disabling', () => {
    const base = emptyKitchen();
    const settings = planningSettings(base);
    settings.sections.push({ id: 'tea', name: 'Afternoon snack', enabled: false });
    const plan = parseKitchenPlan({
      ...base,
      activities: [
        {
          id: 'meal',
          title: 'Toast',
          kind: 'meal',
          start: { day: '2026-09-29', minute: 750 },
          elapsedMinutes: 30,
          handsOnMinutes: 0,
          requiresHome: false,
          notes: ''
        }
      ],
      weekly: { shopping: [], styles: {}, ...base.weekly, settings, mealSections: { meal: 'tea' } }
    });
    expect(mealSlot(plan.activities[0], plan)).toBe('tea');
    expect(visibleSections(plan, ['2026-09-29']).map((s) => s.name)).toContain('Afternoon snack');
    expect(visibleSections(plan, ['2026-09-30']).map((s) => s.name)).not.toContain(
      'Afternoon snack'
    );
  });
});
