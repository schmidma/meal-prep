import { describe, expect, it } from 'vitest';
import { intervalLabel, planChecks, warningKey } from './plan-checks';
import { validateKitchenPlan, type KitchenPlan } from './kitchen';
import type { Activity } from './domain';

const activity = (id: string, day: string, minute: number, elapsedMinutes = 30): Activity => ({
  id,
  title: 'Lunch',
  start: { day, minute },
  elapsedMinutes,
  kind: 'meal',
  handsOnMinutes: 0,
  requiresHome: false,
  notes: ''
});
function fixture(): KitchenPlan {
  return {
    activities: [activity('meal', '2026-09-25', 600), activity('meal2', '2026-09-26', 600)],
    batches: [
      {
        id: 'bread',
        name: 'Bread',
        quantity: 1,
        unit: 'loaves',
        source: { kind: 'existing', availableAt: { day: '2026-09-25', minute: 630 } }
      }
    ],
    allocations: [
      {
        id: 'eat',
        batchId: 'bread',
        activityId: 'meal',
        quantity: 0.25,
        purpose: 'eat',
        when: 'start'
      }
    ],
    ingredients: [{ id: 'carrots', name: 'Carrots', quantity: 4, unit: '' }],
    ingredientUses: [
      { id: 'u1', ingredientId: 'carrots', activityId: 'meal', quantity: 3 },
      { id: 'u2', ingredientId: 'carrots', activityId: 'meal2', quantity: 2 }
    ],
    blockers: [],
    availability: {},
    recipes: [],
    activityRequirements: []
  };
}
const checks = (plan: KitchenPlan) => planChecks(plan, validateKitchenPlan(plan));
describe('plan checks presentation', () => {
  it('formats short, overnight and long gaps as readable intervals', () => {
    expect([30, 90, 1500, 34830].map(intervalLabel)).toEqual([
      '30min',
      '1h 30min',
      '1d 1h',
      '24d 4h 30min'
    ]);
    const plan = fixture();
    plan.batches[0].source = { kind: 'existing', availableAt: { day: '2026-09-26', minute: 30 } };
    expect(checks(plan).find((item) => item.code === 'BEFORE_READY')!.rows[0].evidence).toBe(
      'Fri 25 Sept 10:00 / 14h 30min early'
    );
  });
  it('shows quantity evidence and individually dated contributing uses', () => {
    const check = checks(fixture()).find((item) => item.code === 'OVER_ALLOCATED_INGREDIENT')!;
    expect(check.title).toBe('Carrots: 1 short');
    expect(check.facts.map((fact) => fact.value)).toEqual(['4', '5', '1']);
    expect(check.rows.map((row) => row.key)).toEqual(['u1', 'u2']);
    expect(check.rows.map((row) => row.evidence)).toEqual([
      'Fri 25 Sept 10:00',
      'Sat 26 Sept 10:00'
    ]);
    expect(check.primary?.entity).toEqual({ kind: 'ingredient', id: 'carrots' });
  });
  it('derives fractional need, ready time, and gap without parsing message text', () => {
    const plan = fixture();
    const warnings = validateKitchenPlan(plan).map((warning) => ({
      ...warning,
      message: 'unrelated localized prose'
    }));
    const check = planChecks(plan, warnings).find((item) => item.code === 'BEFORE_READY')!;
    expect(check.facts).toEqual([{ label: 'Ready', value: 'Fri 25 Sept 10:30' }]);
    expect(check.secondary[0]).toMatchObject({
      action: 'Review food readiness',
      reveal: 'availability'
    });
    expect(check.rows[0].detail).toBe('0.25 needed / Eat at start');
    expect(check.rows[0].evidence).toBe('Fri 25 Sept 10:00 / 30min early');
    expect(check.rows[0].action).toMatchObject({
      action: 'Review meal timing',
      reveal: 'schedule',
      at: { day: '2026-09-25', minute: 600 }
    });
  });
  it('groups one batch readiness but retains distinct dated, purpose and parallel allocation rows', () => {
    const plan = fixture();
    plan.batches[0].source = { kind: 'existing', availableAt: { day: '2026-09-27', minute: 600 } };
    plan.allocations.push(
      { ...plan.allocations[0], id: 'parallel' },
      { ...plan.allocations[0], id: 'ingredient', purpose: 'ingredient', when: 'end' },
      { ...plan.allocations[0], id: 'tomorrow', activityId: 'meal2' }
    );
    const warningList = validateKitchenPlan(plan).filter((item) => item.code === 'BEFORE_READY');
    const cards = planChecks(plan, warningList);
    expect(cards).toHaveLength(1);
    expect(cards[0].warningKeys).toEqual(warningList.map(warningKey));
    expect(cards[0].rows).toHaveLength(4);
    expect(new Set(cards[0].rows.map((row) => row.key)).size).toBe(4);
    expect(cards[0].rows[2].detail).toContain('Ingredient at end');
    expect(cards[0].rows[2].action?.at).toEqual({ day: '2026-09-25', minute: 630 });
    expect(cards[0].rows[3].evidence).toContain('Sat 26 Sept');
  });
  it('uses actual overnight end anchors and does not merge same-name batches', () => {
    const plan = fixture();
    plan.activities[0] = activity('meal', '2026-09-24', 1430, 40);
    plan.allocations[0].when = 'end';
    plan.batches[0].source = { kind: 'existing', availableAt: { day: '2026-09-25', minute: 60 } };
    plan.batches.push({ ...plan.batches[0], id: 'bread2' });
    plan.allocations.push({ ...plan.allocations[0], id: 'use2', batchId: 'bread2' });
    const cards = checks(plan).filter((item) => item.code === 'BEFORE_READY');
    expect(cards).toHaveLength(2);
    expect(cards[0].rows[0].action?.at).toEqual({ day: '2026-09-25', minute: 30 });
    expect(cards[0].rows[0].evidence).toContain('30min early');
  });
  it('shows actual dated intersections, and distinguishes advisory parallel activity', () => {
    const plan = fixture();
    plan.activities = [
      activity('meal', '2026-09-24', 1430, 60),
      activity('meal2', '2026-09-25', 10, 60)
    ];
    plan.blockers = [
      {
        id: 'busy',
        title: 'Away',
        start: { day: '2026-09-25', minute: 0 },
        durationMinutes: 20,
        away: true
      }
    ];
    const blocked = checks(plan).find((item) => item.code === 'BLOCKED_TIME')!;
    expect(blocked.facts[0].value).toBe('Fri 25 Sept 00:00 - 00:20 (20 min)');
    expect(blocked.primary?.at).toEqual({ day: '2026-09-25', minute: 0 });
    expect(blocked.secondary[0]).toMatchObject({
      entity: { kind: 'block', id: 'busy' },
      reveal: 'schedule'
    });
    const overlap = checks(plan).find((item) => item.code === 'POSSIBLE_OVERLAP')!;
    expect(overlap.explanation).toContain('Possibly intentional');
    expect(overlap.facts[0].value).toBe('Fri 25 Sept 00:10 - 00:50 (40 min)');
  });
  it('keeps rare, unknown and invalid-date warnings with valid fallback targets', () => {
    const plan = fixture();
    const warning = {
      code: 'FUTURE_NEW_CHECK',
      entityIds: ['eat', 'missing'],
      message: 'A human-readable explanation.'
    };
    const check = planChecks(plan, [warning])[0];
    expect(check.title).toBe('Future new check');
    expect(check.explanation).toBe(warning.message);
    expect(check.primary?.entity.id).toBe('meal');
    expect(check.secondary[0].entity.id).toBe('bread');
    plan.activities[0].start.day = 'invalid';
    expect(() => planChecks(plan, [{ ...warning, code: 'BEFORE_READY' }])).not.toThrow();
    expect(
      planChecks(plan, [{ code: 'INVALID_DAY', entityIds: ['bad'], message: 'Check this date.' }])
    ).toHaveLength(1);
  });
  it('keeps a shortage identity when a contributing activity is removed', () => {
    const plan = fixture();
    plan.ingredientUses[0].quantity = 5;
    const before = checks(plan).find((item) => item.code === 'OVER_ALLOCATED_INGREDIENT')!;
    plan.ingredientUses.pop();
    const after = checks(plan).find((item) => item.code === 'OVER_ALLOCATED_INGREDIENT')!;
    expect(after.key).toBe(before.key);
    expect(after.title).toBe('Carrots: 1 short');
    expect(after.rows).toHaveLength(1);
    plan.batches[0].quantity = 1;
    plan.allocations[0].quantity = 5;
    const batchKey = checks(plan).find((item) => item.code === 'OVER_ALLOCATED')!.key;
    plan.allocations.push({ ...plan.allocations[0], id: 'extra', activityId: 'meal2' });
    expect(checks(plan).find((item) => item.code === 'OVER_ALLOCATED')!.key).toBe(batchKey);
  });
  it.each([0.0001, 0.00000001])(
    'preserves a tiny %s shortage without noise or legacy units',
    (short) => {
      const plan = fixture();
      plan.ingredients[0] = { ...plan.ingredients[0], quantity: 1, unit: 'g' };
      plan.ingredientUses = [{ ...plan.ingredientUses[0], quantity: 1 + short }];
      const check = checks(plan).find((item) => item.code === 'OVER_ALLOCATED_INGREDIENT')!;
      expect(check.facts.map((fact) => fact.value)).toEqual([
        '1',
        short === 0.0001 ? '1.0001' : '≈1',
        short === 0.0001 ? '0.0001' : '0.00000001'
      ]);
      expect(check.title).not.toContain(' g');
      expect(check.title).not.toContain(': 0 short');
    }
  );
  it('orders readiness uses by actual need time rather than allocation insertion order', () => {
    const plan = fixture();
    plan.batches[0].source = { kind: 'existing', availableAt: { day: '2026-09-27', minute: 0 } };
    plan.allocations = [
      { ...plan.allocations[0], id: 'tomorrow', activityId: 'meal2' },
      { ...plan.allocations[0], id: 'end', when: 'end' },
      plan.allocations[0]
    ];
    const rows = checks(plan).find((item) => item.code === 'BEFORE_READY')!.rows;
    expect(rows.map((row) => row.action?.at)).toEqual([
      { day: '2026-09-25', minute: 600 },
      { day: '2026-09-25', minute: 630 },
      { day: '2026-09-26', minute: 600 }
    ]);
  });
  it.each([false, true])(
    'explains ingredient cycles with names, amounts, anchor times and repair targets (self=%s)',
    (self) => {
      const plan = fixture();
      plan.activities[0].title = 'Bake bread';
      plan.activities[1].title = 'Make starter';
      plan.batches[0].source = { kind: 'activity', activityId: 'meal' };
      plan.batches.push({
        ...plan.batches[0],
        id: 'starter',
        name: 'Starter',
        source: { kind: 'activity', activityId: 'meal2' }
      });
      plan.allocations = [
        {
          ...plan.allocations[0],
          purpose: 'ingredient',
          when: 'end',
          activityId: self ? 'meal' : 'meal2'
        }
      ];
      if (!self)
        plan.allocations.push({
          ...plan.allocations[0],
          id: 'return',
          batchId: 'starter',
          activityId: 'meal',
          when: 'start'
        });
      const cards = checks(plan).filter((item) =>
        ['OWN_INGREDIENT', 'INGREDIENT_CYCLE'].includes(item.code)
      );
      expect(cards).toHaveLength(self ? 2 : 1);
      for (const card of cards) {
        expect(card.title).toContain('Bake bread');
        expect(card.explanation).not.toContain('meal');
        expect(card.facts).not.toHaveLength(0);
        expect(card.rows).toHaveLength(self ? 1 : 2);
        expect(card.rows[0].title).toContain('Bread');
        expect(card.rows[0].detail).toBe('0.25 / Ingredient at end');
        expect(card.rows[0].evidence).toContain('10:30');
        expect(card.rows[0].action?.at?.minute).toBe(630);
        expect(card.primary?.action).toContain('Review ingredients in');
        expect(card.secondary[0].entity).toEqual({ kind: 'batch', id: 'bread' });
      }
    }
  );
  it('keeps fractional prepared-food contributors at their individual timing and purpose', () => {
    const plan = fixture();
    plan.batches[0].quantity = 0.1;
    plan.allocations.push({
      ...plan.allocations[0],
      id: 'end',
      when: 'end',
      purpose: 'ingredient'
    });
    const check = checks(plan).find((item) => item.code === 'OVER_ALLOCATED')!;
    expect(check.facts.map((fact) => fact.value)).toEqual(['0.1', '0.5', '0.4']);
    expect(check.rows.map((row) => row.key)).toEqual(['eat', 'end']);
    expect(check.rows[1].evidence).toContain('10:30');
  });
});
