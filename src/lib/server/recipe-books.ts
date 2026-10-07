import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Household } from '../account';
import type { Recipe } from '../kitchen';
import type { RecipeBook, RecipeCatalog } from '../recipe-books';
import { retainPlannedRecipes } from '../recipe-books';
import { emptyKitchen } from '../planner';
import { parseKitchenPlan } from '../plan-document';
import { isPhotoId } from '../food-photos';
import { dataDirectory } from './auth';
import { getPlanStore, type PlanStore } from './plan-store';
import { households } from './households';

export class BookError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const fail = (status = 403, message = 'You do not have permission to change this book.'): never => {
  throw new BookError(status, message);
};
const nameValue = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80)
    return fail(400, 'Choose a book name of up to 80 characters.');
  return value.trim();
};
export class RecipeBookStore {
  private db: DatabaseSync;
  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'recipe-books.sqlite');
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL');
      this.transaction(() => {
        const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
          user_version: number;
        };
        if (version > 1) throw new Error('Unsupported recipe book database version');
        if (version === 0)
          this.db.exec(`
          CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS access(book TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, household TEXT NOT NULL, permission TEXT NOT NULL CHECK(permission IN ('view','contribute')), PRIMARY KEY(book,household));
          CREATE TABLE IF NOT EXISTS recipes(id TEXT PRIMARY KEY, book TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, revision INTEGER NOT NULL, recipe TEXT NOT NULL, image TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS preferences(household TEXT PRIMARY KEY, default_book TEXT REFERENCES books(id) ON DELETE SET NULL, migrated INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY, token TEXT NOT NULL, book TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, permission TEXT NOT NULL CHECK(permission IN ('view','contribute')), expires INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS recipe_book ON recipes(book);
          CREATE INDEX IF NOT EXISTS access_household ON access(household);
          PRAGMA user_version=1;
        `);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private access(household: Household, id: string): RecipeBook {
    const book = this.db
      .prepare(
        `SELECT b.id,b.name,CASE WHEN b.owner=? THEN 'owner' ELSE a.permission END AS access FROM books b LEFT JOIN access a ON a.book=b.id AND a.household=? WHERE b.id=? AND (b.owner=? OR a.household IS NOT NULL)`
      )
      .get(household.id, household.id, id, household.id) as RecipeBook | undefined;
    return book ?? fail(404, 'This recipe book is no longer available.');
  }
  private manage(household: Household, id: string) {
    if (household.role !== 'owner' || this.access(household, id).access !== 'owner') fail();
  }
  private photoPath(id: string) {
    return join(this.directory, 'recipe-photos', `${id}.jpg`);
  }
  private archivePhoto(household: Household, image: string) {
    if (!image.startsWith('upload-')) return;
    const own = join(this.directory, 'households', household.id, 'photos', `${image}.jpg`);
    if (!existsSync(own) && !this.canReadPhoto(household, image))
      fail(400, 'This photo is no longer available.');
    if (existsSync(own)) {
      mkdirSync(join(this.directory, 'recipe-photos'), { recursive: true, mode: 0o700 });
      copyFileSync(own, this.photoPath(image));
      chmodSync(this.photoPath(image), 0o600);
    }
  }
  sharedPhoto(household: Household, id: string): string | undefined {
    return /^upload-[a-f0-9]{64}$/.test(id) && this.canReadPhoto(household, id)
      ? this.photoPath(id)
      : undefined;
  }
  private canReadPhoto(household: Household, image: string) {
    return !!this.db
      .prepare(
        `SELECT 1 FROM recipes r JOIN books b ON b.id=r.book LEFT JOIN access a ON a.book=b.id AND a.household=? WHERE r.image=? AND (b.owner=? OR a.household IS NOT NULL) LIMIT 1`
      )
      .get(household.id, image, household.id);
  }
  retainPhotos(household: Household, images: string[]) {
    for (const image of new Set(images)) {
      if (!/^upload-[a-f0-9]{64}$/.test(image)) continue;
      const folder = join(this.directory, 'households', household.id, 'photos');
      const target = join(folder, `${image}.jpg`);
      if (existsSync(target)) continue;
      const source = this.sharedPhoto(household, image);
      if (!source || !existsSync(source)) return fail(409, 'This photo is no longer available.');
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      copyFileSync(source, target);
      chmodSync(target, 0o600);
    }
  }
  /** Import before removing library rows from the old plan. The checkpoint makes a crash
   * between the two databases recoverable without ever importing a recipe twice. */
  migrate(household: Household, store: PlanStore, name = 'Our recipes') {
    this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM preferences WHERE household=?').get(household.id)) return;
      const plan = store.load().plan;
      const id = randomUUID();
      this.db.prepare('INSERT INTO books VALUES (?,?,?)').run(id, name, household.id);
      for (const recipe of plan.recipes) {
        const image = plan.weekly?.images?.[recipe.id] ?? '';
        this.archivePhoto(household, image);
        const entry = this.cleanRecipe({ ...recipe, id: randomUUID() });
        this.db
          .prepare('INSERT INTO recipes VALUES (?,?,1,?,?)')
          .run(entry.id, id, JSON.stringify(entry), image);
      }
      this.db.prepare('INSERT INTO preferences VALUES (?,?,0)').run(household.id, id);
    });
    const state = this.db
      .prepare('SELECT migrated FROM preferences WHERE household=?')
      .get(household.id) as { migrated: number };
    if (!state.migrated) {
      const saved = store.load();
      store.save(saved.revision, retainPlannedRecipes(saved.plan));
      this.db.prepare('UPDATE preferences SET migrated=1 WHERE household=?').run(household.id);
    }
  }
  catalog(household: Household): RecipeCatalog {
    const books = this.db
      .prepare(
        `SELECT b.id,b.name,CASE WHEN b.owner=? THEN 'owner' ELSE a.permission END AS access FROM books b LEFT JOIN access a ON a.book=b.id AND a.household=? WHERE b.owner=? OR a.household IS NOT NULL ORDER BY b.name,b.id`
      )
      .all(household.id, household.id, household.id) as RecipeBook[];
    const rows = this.db
      .prepare(
        `SELECT r.book AS bookId,r.revision,r.recipe,r.image FROM recipes r JOIN books b ON b.id=r.book LEFT JOIN access a ON a.book=b.id AND a.household=? WHERE b.owner=? OR a.household IS NOT NULL ORDER BY r.id`
      )
      .all(household.id, household.id) as {
      bookId: string;
      revision: number;
      recipe: string;
      image: string;
    }[];
    const preferred = this.db
      .prepare('SELECT default_book FROM preferences WHERE household=?')
      .get(household.id) as { default_book: string } | undefined;
    const defaultBookId =
      books.find((b) => b.id === preferred?.default_book && b.access !== 'view')?.id ??
      books.find((b) => b.access === 'owner')?.id ??
      books.find((b) => b.access === 'contribute')?.id ??
      '';
    return {
      books,
      defaultBookId,
      recipes: rows.map((r) => ({ ...r, recipe: JSON.parse(r.recipe) }))
    };
  }
  create(household: Household, name: unknown) {
    if (household.role !== 'owner') fail();
    const id = randomUUID();
    this.db.prepare('INSERT INTO books VALUES (?,?,?)').run(id, nameValue(name), household.id);
    return id;
  }
  private cleanRecipe(input: unknown): Recipe {
    try {
      // Strip local ingredient identities at the library boundary.
      const r = input as Recipe;
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)) return fail(400, 'Invalid recipe ID.');
      const recipe = {
        ...r,
        ingredients: r.ingredients.map(({ ingredientId: _id, ...row }) => row)
      };
      return parseKitchenPlan({ ...emptyKitchen(), recipes: [recipe] }).recipes[0];
    } catch {
      return fail(400, 'Check the recipe name, ingredients, and portions.');
    }
  }
  save(household: Household, book: string, input: unknown, image: unknown, revision: unknown) {
    return this.transaction(() => {
      if (this.access(household, book).access === 'view') fail();
      const recipe = this.cleanRecipe(input);
      if (typeof image !== 'string' || (image && !isPhotoId(image))) fail(400, 'Invalid photo.');
      const current = this.db
        .prepare('SELECT book,revision,recipe,image FROM recipes WHERE id=?')
        .get(recipe.id) as
        { book: string; revision: number; recipe: string; image: string } | undefined;
      if (current && current.book !== book) fail();
      if (current && current.recipe === JSON.stringify(recipe) && current.image === image) return;
      if (!Number.isSafeInteger(revision) || revision !== (current?.revision ?? 0))
        fail(409, 'This recipe changed. Close it and reopen it before saving.');
      this.archivePhoto(household, image as string);
      this.db
        .prepare(
          'INSERT INTO recipes VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,recipe=excluded.recipe,image=excluded.image'
        )
        .run(recipe.id, book, (revision as number) + 1, JSON.stringify(recipe), image as string);
    });
  }
  removeRecipe(household: Household, id: string, revision: number) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT book,revision FROM recipes WHERE id=?').get(id) as
        { book: string; revision: number } | undefined;
      if (!row) return fail(404, 'This recipe is no longer available.');
      if (this.access(household, row.book).access !== 'owner') fail();
      if (row.revision !== revision)
        fail(409, 'This recipe changed. Close it and reopen it before saving.');
      this.db.prepare('DELETE FROM recipes WHERE id=?').run(id);
    });
  }
  details(household: Household, id: string) {
    this.manage(household, id);
    return {
      access: this.db.prepare('SELECT household,permission FROM access WHERE book=?').all(id),
      invitations: this.db
        .prepare(
          'SELECT hash AS id,token,permission,expires FROM invitations WHERE book=? AND expires>? ORDER BY expires'
        )
        .all(id, Date.now())
    };
  }
  invitation(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return fail(400, 'This invitation is invalid or expired.');
    const row = this.db
      .prepare(
        'SELECT i.book,i.permission,b.name FROM invitations i JOIN books b ON b.id=i.book WHERE i.hash=? AND i.expires>?'
      )
      .get(tokenHash(token), Date.now()) as
      { book: string; permission: 'view' | 'contribute'; name: string } | undefined;
    return row ?? fail(400, 'This invitation is invalid or expired.');
  }
  join(household: Household, token: string) {
    if (household.role !== 'owner') fail();
    this.transaction(() => {
      const invite = this.invitation(token);
      const owner = this.db.prepare('SELECT owner FROM books WHERE id=?').get(invite.book) as {
        owner: string;
      };
      if (owner.owner !== household.id) {
        this.db
          .prepare(
            `INSERT INTO access VALUES (?,?,?) ON CONFLICT(book,household) DO UPDATE SET permission=CASE WHEN access.permission='contribute' THEN 'contribute' ELSE excluded.permission END`
          )
          .run(invite.book, household.id, invite.permission);
        this.db.prepare('DELETE FROM invitations WHERE hash=?').run(tokenHash(token));
      }
    });
  }
  change(household: Household, action: string, id: string, value: string) {
    return this.transaction(() => {
      if (action === 'default') {
        if (household.role !== 'owner' || this.access(household, id).access === 'view') fail();
        this.db
          .prepare('UPDATE preferences SET default_book=? WHERE household=?')
          .run(id, household.id);
        return;
      }
      if (action === 'leave') {
        if (household.role !== 'owner' || this.access(household, id).access === 'owner') fail();
        this.db.prepare('DELETE FROM access WHERE book=? AND household=?').run(id, household.id);
        return;
      }
      this.manage(household, id);
      if (action === 'rename')
        this.db.prepare('UPDATE books SET name=? WHERE id=?').run(nameValue(value), id);
      else if (action === 'delete') this.db.prepare('DELETE FROM books WHERE id=?').run(id);
      else if (action === 'revoke')
        this.db.prepare('DELETE FROM access WHERE book=? AND household=?').run(id, value);
      else if (action === 'revoke-invite')
        this.db.prepare('DELETE FROM invitations WHERE book=? AND hash=?').run(id, value);
      else if (action === 'invite') {
        if (!['view', 'contribute'].includes(value)) fail(400, 'Invalid permission.');
        this.db.prepare('DELETE FROM invitations WHERE expires<=?').run(Date.now());
        const count = this.db
          .prepare('SELECT COUNT(*) AS n FROM invitations WHERE book=?')
          .get(id) as { n: number };
        if (count.n >= 20) fail(429, 'Too many active invitations. Revoke existing links first.');
        const token = randomBytes(32).toString('hex');
        this.db
          .prepare('INSERT INTO invitations VALUES (?,?,?,?,?)')
          .run(tokenHash(token), token, id, value, Date.now() + 7 * 86400000);
        return token;
      } else fail(400, 'Unknown book action.');
    });
  }
  close() {
    this.db.close();
  }
}
let store: RecipeBookStore | undefined;
export function recipeBooks() {
  if (!store) {
    const candidate = new RecipeBookStore(dataDirectory());
    try {
      for (const household of households().all())
        candidate.migrate(household, getPlanStore(household.id));
      store = candidate;
    } catch (error) {
      candidate.close();
      throw error;
    }
  }
  return store;
}
