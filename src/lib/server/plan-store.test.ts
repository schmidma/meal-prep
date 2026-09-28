import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createKitchenPlan,
  setIngredientUse,
  validateKitchenPlan,
  type KitchenPlan
} from '../kitchen';
import { DATABASE_SCHEMA_VERSION, PlanConflictError, PlanStore } from './plan-store';
import { parsePlanDocument } from '../plan-document';
import { createRecipe, instantiateRecipe } from '../recipes';

const dirs: string[] = [];
const stores: PlanStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(seed = () => createKitchenPlan('2026-06-01')) {
  const dir = mkdtempSync(join(tmpdir(), 'meal-prep-'));
  dirs.push(dir);
  const path = join(dir, 'nested', 'plan.sqlite');
  const open = () => {
    const store = new PlanStore(path, seed);
    stores.push(store);
    return store;
  };
  return { path, open };
}

const empty = (): KitchenPlan => ({
  activities: [],
  batches: [],
  allocations: [],
  availability: {},
  ingredients: [],
  ingredientUses: [],
  blockers: [],
  recipes: [],
  activityRequirements: []
});

describe('PlanStore', () => {
  it('reopens full all-date graph, raw ingredients, allocations, blockers and availability', () => {
    const { open } = fixture();
    const first = open();
    const initial = first.load();
    expect(first.load()).toEqual(initial);
    const plan = setIngredientUse(
      structuredClone(initial.plan),
      'ing-paprika',
      initial.plan.activities[0].id,
      9
    );
    plan.availability['2027-01-04'] = {
      label: 'Far away',
      cookable: [{ start: 20, end: 60 }],
      atHome: []
    };
    plan.blockers.push({
      id: 'future',
      title: 'Travel',
      start: { day: '2027-01-04', minute: 25 },
      durationMinutes: 100,
      away: true
    });
    plan.batches.push({
      id: 'pantry',
      name: 'Flour',
      quantity: 3,
      unit: 'kg',
      source: { kind: 'existing', availableAt: { day: '2025-01-01', minute: 0 } }
    });
    plan.allocations.push({
      id: 'future-allocation',
      batchId: 'pantry',
      activityId: plan.activities[0].id,
      quantity: 4,
      purpose: 'ingredient',
      when: 'start'
    });
    const recipe = createRecipe('recipe', 'Soup');
    recipe.ingredients.push({ id: 'recipe-ingredient', name: 'Carrots', quantity: 3 });
    const instance = instantiateRecipe(
      recipe,
      {
        activityId: 'recipe-cook',
        batchId: 'recipe-output',
        start: { day: '2027-01-04', minute: 1000 },
        title: 'Soup tonight',
        durationMinutes: 40,
        yieldQuantity: 6
      },
      () => 'requirement'
    );
    plan.recipes.push(recipe);
    plan.activities.push(instance.activity);
    plan.batches.push(instance.batch);
    plan.activityRequirements.push(...instance.requirements);
    expect(
      validateKitchenPlan(plan).some((warning) => warning.code.includes('OVER_ALLOCATED'))
    ).toBe(true);
    const saved = first.save(initial.revision, plan);
    expect(saved.revision).toBe(initial.revision + 1);
    first.close();
    expect(open().load()).toEqual(saved);
  });

  it('initializes on a first PUT-style save without a prior load', () => {
    const { open } = fixture();
    const store = open();
    const saved = store.save(0, empty());
    expect(saved.revision).toBe(1);
    expect(saved.plan).toEqual(empty());
  });

  it('keeps intentionally empty plans empty after reopening', () => {
    const { open } = fixture();
    const first = open();
    const saved = first.save(first.load().revision, empty());
    first.close();
    expect(open().load()).toEqual(saved);
  });

  it('serializes competing instances, rejects stale changes and accepts idempotent retries', () => {
    const { open } = fixture();
    const a = open();
    const b = open();
    const first = a.load();
    const plan = structuredClone(first.plan);
    plan.ingredients[0].quantity = 7;
    const saved = a.save(first.revision, plan);
    expect(b.save(first.revision, structuredClone(plan))).toEqual(saved);
    const different = structuredClone(plan);
    different.ingredients[0].quantity = 8;
    expect(() => b.save(first.revision, different)).toThrow(PlanConflictError);
    expect(a.load()).toEqual(saved);
  });

  it('lazily normalizes old rows without a write, then atomically upgrades on a real edit', () => {
    const { path, open } = fixture();
    const store = open();
    const initial = store.load();
    store.close();
    const { recipes: _recipes, activityRequirements: _requirements, ...old } = initial.plan;
    old.activities[0].handsOnMinutes = 17;
    old.activities[0].requiresHome = true;
    old.batches[0].unit = 'legacy portions';
    old.blockers[0].away = true;
    const bytes = JSON.stringify(old, null, 2);
    const timestamp = '2025-01-02T03:04:05.000Z';
    const db = new DatabaseSync(path);
    try {
      db.prepare(
        'UPDATE household_plan SET schema_version = 1, revision = 7, updated_at = ?, plan = ? WHERE id = 1'
      ).run(timestamp, bytes);
      const row = () => db.prepare('SELECT * FROM household_plan WHERE id = 1').get();
      const before = row();
      const migrated = open();
      const loaded = migrated.load();
      expect(loaded).toEqual({
        schemaVersion: 2,
        revision: 7,
        updatedAt: timestamp,
        plan: { ...old, recipes: [], activityRequirements: [] }
      });
      expect(parsePlanDocument(loaded)).toEqual(loaded);
      expect(row()).toEqual(before);
      // Canonical equality comes before the stale-revision check and must not write even v1 rows.
      const reordered = Object.fromEntries(Object.entries(loaded.plan).reverse()) as KitchenPlan;
      expect(migrated.save(0, reordered)).toEqual(loaded);
      expect(row()).toEqual(before);
      migrated.close();
      const reopened = open();
      expect(reopened.load()).toEqual(loaded);
      expect(row()).toEqual(before);
      const changed = structuredClone(loaded.plan);
      changed.recipes.push(createRecipe('new-recipe', 'Soup'));
      expect(() => reopened.save(6, changed)).toThrow(PlanConflictError);
      expect(row()).toEqual(before);
      const saved = reopened.save(7, changed);
      expect(saved).toMatchObject({ schemaVersion: 2, revision: 8, plan: changed });
      expect(saved.updatedAt).not.toBe(timestamp);
      const written = row();
      expect(written).toMatchObject({
        schema_version: 2,
        revision: 8,
        updated_at: saved.updatedAt,
        plan: JSON.stringify(changed)
      });
      expect(db.prepare('PRAGMA user_version').get()).toEqual({
        user_version: DATABASE_SCHEMA_VERSION
      });
      expect(DATABASE_SCHEMA_VERSION).toBe(1);
      expect(reopened.save(7, changed)).toEqual(saved);
      expect(row()).toEqual(written);
      reopened.close();
      expect(open().load()).toEqual(saved);
    } finally {
      db.close();
    }
  });

  it.each([1, 3])('refuses mismatched or future row schema %s rather than reseeding', (version) => {
    const { path, open } = fixture();
    const store = open();
    store.load();
    store.close();
    const db = new DatabaseSync(path);
    db.prepare('UPDATE household_plan SET schema_version = ? WHERE id = 1').run(version);
    const before = db.prepare('SELECT * FROM household_plan').get();
    try {
      expect(() => open().load()).toThrow();
      expect(() => open().save(0, empty())).toThrow();
      expect(db.prepare('SELECT * FROM household_plan').get()).toEqual(before);
    } finally {
      db.close();
    }
  });

  it('refuses unsupported database schema and corrupt rows without reseeding', () => {
    const { path, open } = fixture();
    const store = open();
    store.load();
    store.close();
    const db = new DatabaseSync(path);
    db.exec("UPDATE household_plan SET plan = '{broken' WHERE id = 1");
    db.close();
    expect(() => open().load()).toThrow();
    const repair = new DatabaseSync(path);
    expect((repair.prepare('SELECT plan FROM household_plan').get() as { plan: string }).plan).toBe(
      '{broken'
    );
    repair.exec('PRAGMA user_version = 2');
    repair.close();
    expect(() => open().load()).toThrow();
  });
});
