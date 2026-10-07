import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { dataDirectory } from './auth';
import type { Locale } from '../i18n/messages';
import type { Household } from '../account';
export class HouseholdError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export class HouseholdStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY, locale TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS households(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members(user_id TEXT PRIMARY KEY, email TEXT NOT NULL, household_id TEXT NOT NULL REFERENCES households(id), role TEXT NOT NULL CHECK(role IN ('owner','member')));
      CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS member_household ON members(household_id);
    `);
    const columns = this.db.prepare('PRAGMA table_info(invitations)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'token'))
      this.db.exec('ALTER TABLE invitations ADD COLUMN token TEXT');
  }
  all(): Household[] {
    return this.db.prepare("SELECT id,name,'owner' AS role FROM households").all() as Household[];
  }
  name(id: string): string {
    return (
      (
        this.db.prepare('SELECT name FROM households WHERE id=?').get(id) as
          { name: string } | undefined
      )?.name ?? id
    );
  }
  locale(userId: string): Locale | null {
    return (
      (
        this.db.prepare('SELECT locale FROM user_preferences WHERE user_id=?').get(userId) as
          { locale: Locale } | undefined
      )?.locale ?? null
    );
  }
  setLocale(userId: string, locale: Locale) {
    this.db
      .prepare(
        'INSERT INTO user_preferences(user_id,locale) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET locale=excluded.locale'
      )
      .run(userId, locale);
  }
  household(userId: string): Household | null {
    return (
      (this.db
        .prepare(
          'SELECT h.id,h.name,m.role FROM households h JOIN members m ON m.household_id=h.id WHERE m.user_id=?'
        )
        .get(userId) as Household | undefined) ?? null
    );
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private owner(userId: string) {
    const household = this.household(userId);
    if (!household || household.role !== 'owner')
      throw new HouseholdError(403, 'Only household owners can do that.');
    return household;
  }
  private requireAnotherOwner(householdId: string, userId: string) {
    const other = this.db
      .prepare("SELECT 1 FROM members WHERE household_id=? AND role='owner' AND user_id<>? LIMIT 1")
      .get(householdId, userId);
    if (!other)
      throw new HouseholdError(
        400,
        'A household needs at least one owner. Make another member an owner first.'
      );
  }
  create(userId: string, email: string, name: string) {
    if (!name.trim() || name.trim().length > 80)
      throw new HouseholdError(400, 'Choose a household name of up to 80 characters.');
    return this.transaction(() => {
      if (this.household(userId))
        throw new HouseholdError(409, 'You already belong to a household.');
      const id = randomUUID();
      this.db.prepare('INSERT INTO households VALUES (?,?)').run(id, name.trim());
      this.db.prepare('INSERT INTO members VALUES (?,?,?,?)').run(userId, email, id, 'owner');
      return this.household(userId)!;
    });
  }
  details(userId: string) {
    const household = this.household(userId);
    if (!household) throw new HouseholdError(404, 'No household yet.');
    return {
      household,
      invitations:
        household.role === 'owner'
          ? this.db
              .prepare(
                'SELECT hash AS id, expires, token FROM invitations WHERE household_id=? AND expires>? ORDER BY expires DESC, hash'
              )
              .all(household.id, Date.now())
          : [],
      members: this.db
        .prepare(
          'SELECT user_id AS id,email,role FROM members WHERE household_id=? ORDER BY role DESC,email'
        )
        .all(household.id)
    };
  }
  invite(userId: string) {
    return this.transaction(() => {
      const household = this.owner(userId);
      this.db.prepare('DELETE FROM invitations WHERE expires<=?').run(Date.now());
      const count = this.db
        .prepare('SELECT COUNT(*) AS n FROM invitations WHERE household_id=?')
        .get(household.id) as { n: number };
      if (count.n >= 20)
        throw new HouseholdError(429, 'Too many active invitations. Revoke existing links first.');
      const token = randomBytes(32).toString('hex');
      this.db
        .prepare('INSERT INTO invitations (hash,household_id,expires,token) VALUES (?,?,?,?)')
        .run(hash(token), household.id, Date.now() + 7 * 86400000, token);
      return token;
    });
  }
  invitation(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new HouseholdError(400, 'This invitation is invalid or expired.');
    const value = this.db
      .prepare(
        'SELECT h.name FROM invitations i JOIN households h ON h.id=i.household_id WHERE i.hash=? AND i.expires>?'
      )
      .get(hash(token), Date.now()) as { name: string } | undefined;
    if (!value)
      throw new HouseholdError(400, 'This invitation is invalid, expired, or already used.');
    return value;
  }
  join(userId: string, email: string, token: string) {
    return this.transaction(() => {
      if (this.household(userId))
        throw new HouseholdError(409, 'Leave your current household before joining another.');
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new HouseholdError(400, 'This invitation is invalid or expired.');
      const invitation = this.db
        .prepare('SELECT household_id FROM invitations WHERE hash=? AND expires>?')
        .get(hash(token), Date.now()) as { household_id: string } | undefined;
      if (!invitation)
        throw new HouseholdError(400, 'This invitation is invalid, expired, or already used.');
      this.db
        .prepare('INSERT INTO members VALUES (?,?,?,?)')
        .run(userId, email, invitation.household_id, 'member');
      this.db.prepare('DELETE FROM invitations WHERE hash=?').run(hash(token));
      return this.household(userId)!;
    });
  }
  manage(userId: string, action: string, target: string) {
    return this.transaction(() => {
      if (action === 'leave') {
        const household = this.household(userId);
        if (household?.role === 'owner') this.requireAnotherOwner(household.id, userId);
        this.db.prepare('DELETE FROM members WHERE user_id=?').run(userId);
        return;
      }
      const household = this.owner(userId);
      if (action === 'rename') {
        if (!target.trim() || target.trim().length > 80)
          throw new HouseholdError(400, 'Choose a household name of up to 80 characters.');
        this.db.prepare('UPDATE households SET name=? WHERE id=?').run(target.trim(), household.id);
        return;
      }
      if (action === 'revoke-invite') {
        const removed = this.db
          .prepare('DELETE FROM invitations WHERE hash=? AND household_id=?')
          .run(target, household.id);
        if (!removed.changes)
          throw new HouseholdError(404, 'This invitation is no longer available.');
        return;
      }
      if (action === 'revoke') {
        this.db.prepare('DELETE FROM invitations WHERE household_id=?').run(household.id);
        return;
      }
      const member = this.db
        .prepare('SELECT user_id,role FROM members WHERE user_id=? AND household_id=?')
        .get(target, household.id) as { user_id: string; role: string } | undefined;
      if (!member) throw new HouseholdError(400, 'Choose another household member.');
      if (action === 'promote') {
        this.db.prepare("UPDATE members SET role='owner' WHERE user_id=?").run(target);
      } else if (action === 'demote' || action === 'remove') {
        if (action === 'remove' && target === userId)
          throw new HouseholdError(400, 'Use Leave household to remove yourself.');
        if (member.role === 'owner') this.requireAnotherOwner(household.id, target);
        if (action === 'remove') this.db.prepare('DELETE FROM members WHERE user_id=?').run(target);
        else this.db.prepare("UPDATE members SET role='member' WHERE user_id=?").run(target);
      } else throw new HouseholdError(400, 'Unknown household action.');
    });
  }
  close() {
    this.db.close();
  }
}
let store: HouseholdStore | undefined;
export function households() {
  if (!store) {
    mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
    store = new HouseholdStore(join(dataDirectory(), 'households.sqlite'));
  }
  return store;
}
