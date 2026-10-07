import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecipeBookStore } from './recipe-books';
import { PlanStore } from './plan-store';
import { emptyKitchen } from '../planner';
import type { Household } from '../account';
import type { Recipe } from '../kitchen';
import { catalogRecipes, planningCatalog, retainPlannedRecipes, snapshotId } from '../recipe-books';
import { linkIngredients } from '../ingredient-library';
vi.mock('./auth', () => ({ dataDirectory: () => '/tmp' }));
const dirs: string[] = [];
const stores: { close(): void }[] = [];
const owner: Household = { id: 'owner-home', name: 'Home', role: 'owner' };
const friend: Household = { id: 'friend-home', name: 'Friend', role: 'owner' };
const reader: Household = { id: 'reader-home', name: 'Reader', role: 'owner' };
const recipe: Recipe = {
  id: 'recipe-old',
  name: 'Soup',
  yieldQuantity: 4,
  durationMinutes: 30,
  ingredients: [{ id: 'ingredient-row', name: 'Carrots', quantity: 2, unit: '' }],
  instructions: 'Simmer.'
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'books-'));
  dirs.push(dir);
  const books = new RecipeBookStore(dir);
  stores.push(books);
  const plan = new PlanStore(join(dir, 'plan.sqlite'), () => ({
    ...emptyKitchen(),
    recipes: [recipe]
  }));
  stores.push(plan);
  books.migrate(owner, plan);
  return { dir, books, plan, book: books.catalog(owner).defaultBookId };
}
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  vi.useRealTimers();
});
it('migrates an existing library once, retaining planned snapshots and private ingredients', () => {
  const { dir, books, plan } = fixture();
  expect(books.catalog(owner).recipes[0].recipe.name).toBe('Soup');
  expect(plan.load().plan.recipes).toEqual([]);
  books.migrate(owner, plan);
  expect(books.catalog(owner).books).toHaveLength(1);
  expect(books.catalog(owner).recipes).toHaveLength(1);
  const local = new PlanStore(join(dir, 'planned.sqlite'), () =>
    linkIngredients({
      ...emptyKitchen(),
      recipes: [recipe],
      weekly: {
        styles: {},
        shopping: [],
        sessions: [
          {
            id: 'cook',
            day: '2026-10-04',
            name: 'Soup',
            quantity: 4,
            notes: 'Simmer.',
            recipeId: recipe.id
          }
        ]
      }
    })
  );
  stores.push(local);
  books.migrate(friend, local);
  expect(local.load().plan.recipes).toHaveLength(1);
  expect(local.load().plan.weekly?.ingredientLibrary?.[0].name).toBe('Carrots');
  expect(books.catalog(friend).recipes[0].recipe.ingredients[0].ingredientId).toBeUndefined();
});
it('resumes an interrupted migration without duplicate books or losing recipes', () => {
  const { dir, books, plan } = fixture();
  const second = new PlanStore(join(dir, 'second.sqlite'), () => ({
    ...emptyKitchen(),
    recipes: [recipe]
  }));
  stores.push(second);
  const original = second.save.bind(second);
  vi.spyOn(second, 'save').mockImplementationOnce(() => {
    throw new Error('Interrupted');
  });
  expect(() => books.migrate(friend, second)).toThrow('Interrupted');
  expect(books.catalog(friend).recipes).toHaveLength(1);
  second.save = original;
  books.migrate(friend, second);
  expect(books.catalog(friend).books).toHaveLength(1);
  expect(books.catalog(friend).recipes).toHaveLength(1);
  expect(second.load().plan.recipes).toEqual([]);
  // A restart uses the durable checkpoint as well.
  const restarted = new RecipeBookStore(dir);
  stores.push(restarted);
  restarted.migrate(owner, plan);
  expect(restarted.catalog(owner).recipes).toHaveLength(1);
});
it('authorizes household contributions, keeps readers read-only and detects concurrent edits', () => {
  const { books, book } = fixture();
  const token = books.change(owner, 'invite', book, 'contribute')!;
  books.join(friend, token);
  expect(() => books.join(reader, token)).toThrow(/expired/);
  books.join(reader, books.change(owner, 'invite', book, 'view')!);
  const entry = books.catalog(friend).recipes[0];
  expect(books.catalog({ ...friend, role: 'member' }).recipes).toHaveLength(1);
  books.save(friend, book, { ...entry.recipe, name: 'New soup' }, '', 1);
  expect(() => books.save(owner, book, entry.recipe, '', 1)).toThrow(/changed/);
  expect(() => books.save(reader, book, entry.recipe, '', 2)).toThrow(/permission/);
  expect(() => books.removeRecipe(friend, entry.recipe.id, 2)).toThrow(/permission/);
  expect(() => books.change({ ...owner, role: 'member' }, 'invite', book, 'view')).toThrow(
    /permission/
  );
  books.change(owner, 'revoke', book, friend.id);
  expect(books.catalog(friend).recipes).toEqual([]);
  expect(() => books.save(friend, book, entry.recipe, '', 2)).toThrow(/available/);
  books.removeRecipe(owner, entry.recipe.id, 2);
});
it('keeps independent copies and planned versions after editing or losing access', () => {
  const { books, book } = fixture();
  books.join(friend, books.change(owner, 'invite', book, 'contribute')!);
  const before = books.catalog(friend);
  const entry = before.recipes[0];
  let plan = planningCatalog(emptyKitchen(), before);
  plan = retainPlannedRecipes({
    ...plan,
    weekly: {
      ...plan.weekly!,
      sessions: [
        {
          id: 'cook',
          name: 'Soup',
          day: '2026-10-04',
          quantity: 4,
          notes: 'Simmer.',
          recipeId: snapshotId(entry)
        }
      ]
    }
  });
  const copyBook = books.create(friend, 'My adaptations');
  books.save(friend, copyBook, { ...entry.recipe, id: 'independent' }, '', 0);
  books.save(owner, book, { ...entry.recipe, name: 'Changed', yieldQuantity: 6 }, '', 1);
  books.change(owner, 'delete', book, '');
  expect(books.catalog(friend).recipes[0].recipe.name).toBe('Soup');
  expect(plan.recipes[0].name).toBe('Soup');
  expect(plan.recipes[0].yieldQuantity).toBe(4);
  expect(
    planningCatalog(plan, books.catalog(friend)).recipes.find((r) => r.id === snapshotId(entry))
      ?.name
  ).toBe('Soup');
});
it('only serves shared photos while authorized, but retains photos used in plans', () => {
  const { dir, books, book } = fixture();
  const image = `upload-${'a'.repeat(64)}`;
  mkdirSync(join(dir, 'households', owner.id, 'photos'), { recursive: true });
  writeFileSync(join(dir, 'households', owner.id, 'photos', `${image}.jpg`), 'photo');
  const entry = books.catalog(owner).recipes[0];
  books.save(owner, book, entry.recipe, image, 1);
  expect(books.sharedPhoto(friend, image)).toBeUndefined();
  books.join(friend, books.change(owner, 'invite', book, 'view')!);
  expect(books.sharedPhoto(friend, image)).toBeTruthy();
  books.retainPhotos(friend, [image]);
  books.change(owner, 'revoke', book, friend.id);
  expect(books.sharedPhoto(friend, image)).toBeUndefined();
  expect(readFileSync(join(dir, 'households', friend.id, 'photos', `${image}.jpg`), 'utf8')).toBe(
    'photo'
  );
  expect(() => books.retainPhotos(reader, [image])).toThrow(/photo/);
});
it('matches shared ingredient names through household aliases without importing foreign IDs', () => {
  const { books } = fixture();
  const plan = {
    ...emptyKitchen(),
    weekly: {
      styles: {},
      shopping: [],
      ingredientLibrary: [{ id: 'local-carrot', name: 'Möhren', aliases: ['Carrots'] }]
    }
  };
  const projected = catalogRecipes(books.catalog(owner), plan);
  expect(projected[0].ingredients[0]).toMatchObject({
    name: 'Möhren',
    ingredientId: 'local-carrot'
  });
  expect(books.catalog(owner).recipes[0].recipe.ingredients[0].name).toBe('Carrots');
});
it('expired and revoked invitations cannot grant access and defaults recover when access is lost', () => {
  const { books, book } = fixture();
  const token = books.change(owner, 'invite', book, 'contribute')!;
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 8 * 86400000);
  expect(() => books.join(friend, token)).toThrow(/expired/);
  vi.useRealTimers();
  const second = books.change(owner, 'invite', book, 'contribute')!;
  const invitation = (
    books.details(owner, book).invitations as { id: string; token: string }[]
  ).find((i) => i.token === second)!;
  books.change(owner, 'revoke-invite', book, invitation.id);
  expect(() => books.join(friend, second)).toThrow(/expired/);
  const own = books.create(owner, 'Other');
  books.change(owner, 'default', own, '');
  books.change(owner, 'delete', own, '');
  expect(books.catalog(owner).defaultBookId).toBe(book);
});

it('rolls back an incomplete import and preserves the original plan until every recipe is copied', () => {
  const { dir, books } = fixture();
  const image = `upload-${'b'.repeat(64)}`;
  const legacy = new PlanStore(join(dir, 'legacy.sqlite'), () => ({
    ...emptyKitchen(),
    recipes: [recipe, { ...recipe, id: 'second', ingredients: [] }],
    weekly: { styles: {}, shopping: [], images: { second: image } }
  }));
  stores.push(legacy);
  const before = legacy.load();
  expect(() => books.migrate(friend, legacy)).toThrow(/photo/);
  expect(books.catalog(friend).books).toEqual([]);
  expect(legacy.load()).toEqual(before);
  mkdirSync(join(dir, 'households', friend.id, 'photos'), { recursive: true });
  writeFileSync(join(dir, 'households', friend.id, 'photos', `${image}.jpg`), 'photo');
  books.migrate(friend, legacy);
  expect(books.catalog(friend).recipes).toHaveLength(2);
  expect(books.sharedPhoto(friend, image)).toBeTruthy();
  expect(legacy.load().plan.recipes).toEqual([]);
});
