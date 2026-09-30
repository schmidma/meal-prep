import { emptyKitchen } from '../planner';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { KitchenPlan } from '../kitchen';
import {
  PLAN_SCHEMA_VERSION,
  parseKitchenPlan,
  parsePlanDocument,
  planKey,
  type PlanDocument
} from '../plan-document';

export const DATABASE_SCHEMA_VERSION = 1;

export class PlanConflictError extends Error {
  constructor() {
    super('Plan revision conflict');
    this.name = 'PlanConflictError';
  }
}

export class PlanStore {
  private db?: DatabaseSync;

  constructor(
    private readonly path: string,
    private readonly seedFactory: () => KitchenPlan = emptyKitchen
  ) {}

  private database(): DatabaseSync {
    if (this.db) return this.db;
    const directory = dirname(resolve(this.path));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.path);
    try {
      // SQLite derives new journal/WAL permissions from the database file.
      chmodSync(this.path, 0o600);
      db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
      try {
        const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
        if (version.user_version === 0) {
          const existing = db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            .get();
          if (existing) throw new Error('Unversioned database is not empty');
          db.exec(`CREATE TABLE household_plan (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            revision INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            plan TEXT NOT NULL
          );
          PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};`);
        } else if (version.user_version !== DATABASE_SCHEMA_VERSION) {
          throw new Error('Unsupported database version');
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
      this.db = db;
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private read(db: DatabaseSync): PlanDocument | undefined {
    const row = db
      .prepare('SELECT schema_version, revision, updated_at, plan FROM household_plan WHERE id = 1')
      .get() as
      | { schema_version: unknown; revision: unknown; updated_at: unknown; plan: unknown }
      | undefined;
    if (!row) return undefined;
    if (typeof row.plan !== 'string') throw new Error('Corrupt stored plan');
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.plan);
    } catch {
      throw new Error('Corrupt stored plan');
    }
    return parsePlanDocument({
      schemaVersion: row.schema_version,
      revision: row.revision,
      updatedAt: row.updated_at,
      plan: parsed
    });
  }

  private readOrSeed(db: DatabaseSync): PlanDocument {
    let document = this.read(db);
    if (!document) {
      const plan = parseKitchenPlan(this.seedFactory());
      const updatedAt = new Date().toISOString();
      db.prepare(
        'INSERT OR IGNORE INTO household_plan (id, schema_version, revision, updated_at, plan) VALUES (1, ?, 0, ?, ?)'
      ).run(PLAN_SCHEMA_VERSION, updatedAt, JSON.stringify(plan));
      document = this.read(db);
      if (!document) throw new Error('Unable to initialize plan');
    }
    return document;
  }

  load(): PlanDocument {
    const db = this.database();
    db.exec('BEGIN IMMEDIATE');
    try {
      const document = this.readOrSeed(db);
      db.exec('COMMIT');
      return document;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  save(expectedRevision: number, input: KitchenPlan): PlanDocument {
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new Error('Invalid expected revision');
    const plan = parseKitchenPlan(input);
    const db = this.database();
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.readOrSeed(db);
      if (planKey(current.plan) === planKey(plan)) {
        db.exec('COMMIT');
        return current;
      }
      if (current.revision !== expectedRevision) throw new PlanConflictError();
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Revision overflow');
      const updatedAt = new Date().toISOString();
      const result = db
        .prepare(
          'UPDATE household_plan SET schema_version = ?, revision = revision + 1, updated_at = ?, plan = ? WHERE id = 1 AND revision = ?'
        )
        .run(PLAN_SCHEMA_VERSION, updatedAt, JSON.stringify(plan), expectedRevision);
      if (result.changes !== 1) throw new PlanConflictError();
      const document = this.read(db);
      if (!document) throw new Error('Missing stored plan');
      db.exec('COMMIT');
      return document;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }
}

const stores = new Map<string, PlanStore>();
export function getPlanStore(householdId?: string): PlanStore {
  const base = resolve(process.env.MEAL_PREP_DB_PATH || 'data/meal-prep.sqlite');
  if (householdId && !/^[a-f0-9-]{36}$/.test(householdId)) throw new Error('Invalid household ID');
  const path = householdId ? join(dirname(base), 'households', householdId, 'plan.sqlite') : base;
  let store = stores.get(path);
  if (!store) {
    store = new PlanStore(path, emptyKitchen);
    stores.set(path, store);
  }
  return store;
}
