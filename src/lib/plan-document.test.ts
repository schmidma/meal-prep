import { createKitchenPlan } from '../../tests/fixtures/legacy-plan';
import { describe, expect, it } from 'vitest';
import { MAX_ACTIVITY_MINUTES } from './domain';
import { type KitchenPlan } from './kitchen';
import {
  LEGACY_MAX_PLAN_BYTES,
  MAX_PLAN_BYTES,
  migrateV1KitchenPlan,
  parseKitchenPlan,
  parsePlanDocument,
  parseSaveRequest,
  parseV1RecoverySaveRequest,
  planKey
} from './plan-document';

const seed = () => createKitchenPlan('2026-06-01');
const copy = <T>(value: T): T => structuredClone(value);
const legacy = (plan = seed()) => {
  const { recipes: _recipes, activityRequirements: _requirements, ...old } = plan;
  return old;
};
const envelope = (plan: unknown = seed(), schemaVersion = 2) => ({
  schemaVersion,
  revision: 2,
  updatedAt: '2026-06-01T12:00:00.000Z',
  plan
});
const withRecipe = (): KitchenPlan => ({
  ...seed(),
  recipes: [
    {
      id: 'recipe',
      name: 'Soup',
      yieldQuantity: 4,
      durationMinutes: 45,
      ingredients: [{ id: 'recipe-carrots', name: 'Carrots', quantity: 2 }],
      instructions: 'Simmer.'
    }
  ],
  activityRequirements: [{ id: 'need', activityId: 'cook-curry', name: 'Carrots', quantity: 3 }]
});

describe('plan document validation', () => {
  it('retains every graph field and compares differently ordered object keys', () => {
    const plan = withRecipe();
    expect(parseKitchenPlan(plan)).toEqual(plan);
    expect(planKey(plan)).toBe(planKey(JSON.parse(JSON.stringify(plan))));
    expect(planKey({ ...plan, blockers: [...plan.blockers].reverse() })).not.toBe(planKey(plan));
    expect(parseSaveRequest({ schemaVersion: 2, revision: 0, plan }).plan).toEqual(plan);
    expect(parsePlanDocument(envelope(plan))).toEqual(envelope(plan));
  });

  it('preserves legacy values exactly through migration and repeated parsing', () => {
    const plan = seed();
    plan.activities[0].handsOnMinutes = plan.activities[0].elapsedMinutes + 1;
    plan.activities[0].requiresHome = true;
    plan.batches[0].unit = 'slices';
    plan.ingredients[0].unit = 'g';
    plan.blockers[0].away = true;
    plan.availability = {
      [plan.activities[0].start.day]: { label: 'Unavailable', cookable: [], atHome: [] }
    };
    const old = legacy(plan);
    const bytes = JSON.stringify(old);
    const migrated = migrateV1KitchenPlan(old);
    expect(migrated).toEqual(plan);
    expect(JSON.stringify(legacy(migrated))).toBe(bytes);
    expect(JSON.stringify(old)).toBe(bytes);
    expect(parsePlanDocument(envelope(old, 1))).toEqual(envelope(plan));
    expect(parsePlanDocument(parsePlanDocument(envelope(old, 1)))).toEqual(envelope(plan));
    expect(parseV1RecoverySaveRequest({ schemaVersion: 1, revision: 2, plan: old })).toEqual({
      schemaVersion: 2,
      revision: 2,
      plan
    });
    expect(parseSaveRequest({ schemaVersion: 2, revision: 2, plan }).plan).toEqual(plan);
  });

  it('rejects v1 writes, future versions, partial migrations and mixed envelopes', () => {
    expect(() => parseKitchenPlan(legacy())).toThrow();
    expect(() => migrateV1KitchenPlan(seed())).toThrow();
    expect(() => migrateV1KitchenPlan({ ...legacy(), recipes: [] })).toThrow();
    expect(() => parseKitchenPlan({ ...legacy(), recipes: [] })).toThrow();
    expect(() => parsePlanDocument(envelope(seed(), 1))).toThrow();
    expect(() => parsePlanDocument(envelope(legacy(), 2))).toThrow();
    expect(() => parsePlanDocument(envelope(seed(), 3))).toThrow();
    expect(() => parsePlanDocument({ ...envelope(), extra: true })).toThrow();
    for (const plan of [legacy(), seed()])
      expect(() => parseSaveRequest({ schemaVersion: 1, revision: 0, plan })).toThrow();
    expect(() => parseSaveRequest({ schemaVersion: 3, revision: 0, plan: seed() })).toThrow();
    expect(() =>
      parseV1RecoverySaveRequest({ schemaVersion: 2, revision: 0, plan: seed() })
    ).toThrow();
    expect(() =>
      parseV1RecoverySaveRequest({ schemaVersion: 1, revision: 0, plan: seed() })
    ).toThrow();
    expect(() =>
      parseV1RecoverySaveRequest({ schemaVersion: 1, revision: -1, plan: legacy() })
    ).toThrow();
    expect(() =>
      parseSaveRequest({ schemaVersion: 2, revision: Number.MAX_SAFE_INTEGER, plan: seed() })
    ).toThrow();
    expect(() => parsePlanDocument({ ...envelope(), updatedAt: 'yesterday' })).toThrow();
  });

  it('rejects malformed legacy fields, unsafe numbers, dates and references in either schema', () => {
    const bad = [
      null,
      [],
      { ...seed(), extra: 1 },
      { ...seed(), blockers: null },
      { ...seed(), ingredients: [{ ...seed().ingredients[0], quantity: Infinity }] },
      { ...seed(), ingredients: [{ ...seed().ingredients[0], name: '   ' }] },
      { ...seed(), availability: { '2026-02-30': { label: '', cookable: [], atHome: [] } } },
      {
        ...seed(),
        blockers: [
          {
            ...seed().blockers[0],
            start: { day: '9999-12-31', minute: 1400 },
            durationMinutes: 100
          }
        ]
      },
      { ...seed(), activities: [{ ...seed().activities[0], elapsedMinutes: -1 }] },
      {
        ...seed(),
        availability: {
          '2026-06-01': { label: '', cookable: [{ start: 100, end: 100 }], atHome: [] }
        }
      }
    ];
    for (const item of bad) {
      expect(() => parseKitchenPlan(item)).toThrow();
      if (item && !Array.isArray(item))
        expect(() => migrateV1KitchenPlan(legacy(item as KitchenPlan))).toThrow();
    }
    const plan = seed();
    const badBatch = copy(plan);
    badBatch.batches[0].source = { kind: 'activity', activityId: 'missing' };
    expect(() => parseKitchenPlan(badBatch)).toThrow();
    const badAllocation = copy(plan);
    badAllocation.allocations[0].batchId = 'missing';
    expect(() => parseKitchenPlan(badAllocation)).toThrow();
    const badUse = copy(plan);
    badUse.ingredientUses.push({
      id: 'use',
      ingredientId: 'missing',
      activityId: plan.activities[0].id,
      quantity: 1
    });
    expect(() => parseKitchenPlan(badUse)).toThrow();
    const duplicate = copy(plan);
    duplicate.ingredients[0].id = duplicate.activities[0].id;
    expect(() => parseKitchenPlan(duplicate)).toThrow();
    const unsafe = copy(plan);
    unsafe.blockers[0].durationMinutes = Number.MAX_SAFE_INTEGER;
    expect(() => parseKitchenPlan(unsafe)).toThrow();
  });

  it('strictly validates recipes, nested ingredients and activity requirements', () => {
    const mutations: ((plan: KitchenPlan) => void)[] = [
      (p) => {
        p.recipes = null as unknown as KitchenPlan['recipes'];
      },
      (p) => {
        p.activityRequirements = null as unknown as KitchenPlan['activityRequirements'];
      },
      (p) => {
        p.recipes[0].name = ' ';
      },
      (p) => {
        p.recipes[0].instructions = 'x'.repeat(10_001);
      },
      (p) => {
        p.recipes[0].durationMinutes = MAX_ACTIVITY_MINUTES + 1;
      },
      (p) => {
        p.recipes[0].durationMinutes = 1.5;
      },
      (p) => {
        p.recipes[0].durationMinutes = -1;
      },
      (p) => {
        p.recipes[0].ingredients[0].name = '';
      },
      (p) => {
        p.activityRequirements[0].name = '';
      },
      (p) => {
        p.activityRequirements[0].activityId = 'missing';
      },
      (p) => {
        Object.assign(p.recipes[0], { unit: 'g' });
      },
      (p) => {
        Object.assign(p.recipes[0].ingredients[0], { unit: 4 });
      },
      (p) => {
        Object.assign(p.activityRequirements[0], { ingredientId: 'ing-paprika' });
      },
      (p) => {
        delete (p.recipes[0] as Partial<KitchenPlan['recipes'][number]>).instructions;
      },
      (p) => {
        p.recipes[0].id = p.activities[0].id;
      },
      (p) => {
        p.recipes[0].ingredients[0].id = p.ingredients[0].id;
      },
      (p) => {
        p.activityRequirements[0].id = p.recipes[0].ingredients[0].id;
      },
      (p) => {
        p.recipes.push({ ...copy(p.recipes[0]), id: 'other-recipe' });
      }
    ];
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      mutations.push((p) => {
        p.recipes[0].yieldQuantity = bad;
      });
      mutations.push((p) => {
        p.recipes[0].ingredients[0].quantity = bad;
      });
      mutations.push((p) => {
        p.activityRequirements[0].quantity = bad;
      });
    }
    for (const mutate of mutations) {
      const plan = withRecipe();
      mutate(plan);
      expect(() => parseKitchenPlan(plan)).toThrow();
    }
    const valid = withRecipe();
    valid.recipes[0].durationMinutes = 0;
    expect(parseKitchenPlan(valid)).toEqual(valid);
    valid.recipes[0].durationMinutes = MAX_ACTIVITY_MINUTES;
    expect(parseKitchenPlan(valid)).toEqual(valid);
  });

  it('preserves the full legacy UTF-8 byte budget after migration and double parsing', () => {
    const old = legacy();
    const size = () => new TextEncoder().encode(JSON.stringify(old)).length;
    while (LEGACY_MAX_PLAN_BYTES - size() > 10_000) {
      old.ingredients.push({
        id: `padding-${old.ingredients.length}`,
        name: 'é'.repeat(4500),
        quantity: 1,
        unit: ''
      });
    }
    old.ingredients.push({ id: 'boundary', name: '🥕', quantity: 1, unit: '' });
    old.ingredients.at(-1)!.name += 'x'.repeat(LEGACY_MAX_PLAN_BYTES - size());
    expect(size()).toBe(LEGACY_MAX_PLAN_BYTES);
    const migrated = migrateV1KitchenPlan(old);
    expect(new TextEncoder().encode(JSON.stringify(migrated)).length).toBe(MAX_PLAN_BYTES);
    expect(MAX_PLAN_BYTES - LEGACY_MAX_PLAN_BYTES).toBe(39);
    expect(parsePlanDocument(parsePlanDocument(envelope(old, 1))).plan).toEqual(migrated);
    expect(parseSaveRequest({ schemaVersion: 2, revision: 0, plan: migrated }).plan).toEqual(
      migrated
    );
    old.ingredients.at(-1)!.name += 'x';
    expect(() => migrateV1KitchenPlan(old)).toThrow('500 kB');
    migrated.ingredients.at(-1)!.name += 'x';
    expect(() => parseKitchenPlan(migrated)).toThrow('500 kB');
  });
});

it('preserves optional recipe links on leftovers', () => {
  const plan = withRecipe();
  plan.batches[0].recipeId = 'recipe';
  expect(parseKitchenPlan(plan).batches[0].recipeId).toBe('recipe');
  expect(() =>
    parseKitchenPlan({ ...plan, batches: [{ ...plan.batches[0], recipeId: 12 }] })
  ).toThrow();
});
