import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signIn, householdAction, origin } from './auth-helpers';
import type { RecipeCatalog } from '../src/lib/recipe-books';

async function setup(request: APIRequestContext, name: string) {
  await signIn(request, `books-${randomUUID()}@example.test`);
  expect((await householdAction(request, { action: 'create', name })).ok()).toBeTruthy();
  return (await (await request.get('/api/books')).json()) as RecipeCatalog;
}
async function action(request: APIRequestContext, body: object) {
  const result = await request.post('/api/books', { headers: { Origin: origin }, data: body });
  expect(result.ok(), await result.text()).toBeTruthy();
  return (await result.json()) as RecipeCatalog;
}
async function addRecipe(request: APIRequestContext, book: string, name: string) {
  return action(request, {
    action: 'save',
    book,
    revision: 0,
    image: 'sketch-curry',
    recipe: {
      id: randomUUID(),
      name,
      yieldQuantity: 4,
      durationMinutes: 30,
      instructions: 'Simmer gently.',
      ingredients: [{ id: randomUUID(), name: 'Chickpeas', quantity: 2, unit: 'tins' }]
    }
  });
}

test('households share a book, search all books, and retain cooking snapshots after edits and revocation', async ({
  page,
  browser
}, info) => {
  const owner = await setup(page.request, 'Owner kitchen');
  await addRecipe(page.request, owner.defaultBookId, 'Shared curry');
  const friend = await browser.newContext();
  try {
    const own = await setup(friend.request, 'Friend kitchen');
    await addRecipe(friend.request, own.defaultBookId, 'Private soup');
    await page.goto('/');
    await page.getByRole('button', { name: /^Recipes/ }).click();
    await page.getByRole('button', { name: 'Manage books', exact: true }).click();
    await page.getByLabel('Book name', { exact: true }).fill('Friends’ favourites');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Create invitation' }).click();
    const link = page.locator('.wp-book-access-row a').first();
    await expect(link).toBeVisible();
    const path = await link.getAttribute('href');
    await page.screenshot({ path: `/tmp/books-sharing-${info.project.name}.png` });
    const friendPage = await friend.newPage();
    await friendPage.goto(path!);
    await expect(
      friendPage.getByText('Share this book with your household, Friend kitchen.')
    ).toBeVisible();
    await friendPage.getByRole('button', { name: 'Accept for our household' }).click();
    await expect(friendPage.locator('.wp-recipe')).toHaveCount(2);
    await expect(
      friendPage.getByRole('combobox', { name: 'Recipe book', exact: true })
    ).toHaveValue('');
    await friendPage.getByRole('combobox', { name: 'Search recipes', exact: true }).fill('curry');
    await expect(friendPage.locator('.wp-recipe')).toHaveCount(1);
    await friendPage.getByRole('button', { name: 'Plan a cook', exact: true }).click();
    await friendPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(friendPage.getByRole('dialog')).toHaveCount(0);
    await expect(friendPage.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
    const planned = await (await friend.request.get('/api/plan')).json();
    expect(planned.plan.weekly.sessions[0].name).toBe('Shared curry');
    expect(planned.plan.weekly.sessions[0].notes).toContain('2 tins Chickpeas');
    const shared = (await (await page.request.get('/api/books')).json()).recipes[0];
    await action(page.request, {
      action: 'save',
      book: shared.bookId,
      recipe: { ...shared.recipe, name: 'Changed curry', yieldQuantity: 8 },
      image: shared.image,
      revision: shared.revision
    });
    const details = await (await page.request.get(`/api/books?book=${owner.defaultBookId}`)).json();
    await action(page.request, {
      action: 'revoke',
      book: owner.defaultBookId,
      value: details.access[0].household
    });
    await friendPage.reload();
    await expect(friendPage.locator('.wp-recipe')).toHaveCount(1);
    const retained = await (await friend.request.get('/api/plan')).json();
    expect(retained.plan.weekly.sessions[0]).toEqual(planned.plan.weekly.sessions[0]);
    expect(retained.plan.recipes[0].yieldQuantity).toBe(4);
  } finally {
    await friend.close();
  }
});

test('readers can plan and copy recipes but cannot edit the shared original', async ({
  page,
  playwright
}) => {
  const owner = await playwright.request.newContext({ baseURL: origin });
  try {
    const ownerCatalog = await setup(owner, 'Library owner');
    await addRecipe(owner, ownerCatalog.defaultBookId, 'Read-only curry');
    const own = await setup(page.request, 'Reader kitchen');
    await action(owner, { action: 'invite', book: ownerCatalog.defaultBookId, value: 'view' });
    const details = await (await owner.get(`/api/books?book=${ownerCatalog.defaultBookId}`)).json();
    await action(page.request, { action: 'join', value: details.invitations[0].token });
    await page.goto('/?view=recipes');
    await page.getByRole('button', { name: /recipe Read-only curry/ }).click();
    await expect(page.getByLabel('Name', { exact: true })).not.toBeEditable();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Copy recipe', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toBeEditable();
    await expect(page.getByRole('combobox', { name: 'Save in' })).toHaveValue(own.defaultBookId);
    await page.getByLabel('Name', { exact: true }).fill('My curry');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.wp-recipe')).toHaveCount(2);
    expect((await (await owner.get('/api/books')).json()).recipes[0].recipe.name).toBe(
      'Read-only curry'
    );
    const shared = (await (await owner.get('/api/books')).json()).recipes[0];
    const denied = await page.request.post('/api/books', {
      headers: { Origin: origin },
      data: {
        action: 'save',
        book: shared.bookId,
        recipe: shared.recipe,
        image: shared.image,
        revision: shared.revision
      }
    });
    expect(denied.status()).toBe(403);
  } finally {
    await owner.dispose();
  }
});

test('book creation, default destination and deletion work on desktop and phone', async ({
  page
}, info) => {
  await setup(page.request, 'Book tests');
  await page.goto('/?view=recipes');
  await page.getByRole('button', { name: 'Manage books', exact: true }).click();
  await page.getByRole('button', { name: 'Create book', exact: true }).click();
  await page.getByLabel('Book name', { exact: true }).fill('Quick dinners');
  await page.getByRole('button', { name: 'Create book', exact: true }).click();
  await expect(page.getByLabel('Book name')).toHaveValue('Quick dinners');
  await page.getByRole('button', { name: 'Use as default book' }).click();
  await expect(page.getByRole('button', { name: 'Default book', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Add a recipe', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Save in' }).locator('option:checked')
  ).toHaveText('Quick dinners');
  await page.getByLabel('Name', { exact: true }).fill('New supper');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.wp-recipe')).toHaveCount(1);
  await page.screenshot({ path: `/tmp/books-recipes-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Manage books', exact: true }).click();
  await page.getByRole('button', { name: 'Delete book', exact: true }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Delete book', exact: true })
    .click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.wp-recipe')).toHaveCount(0);
});

test('a book invitation survives sign-in and creation of a new household', async ({
  page,
  playwright
}) => {
  const owner = await playwright.request.newContext({ baseURL: origin });
  try {
    const catalog = await setup(owner, 'Host');
    await addRecipe(owner, catalog.defaultBookId, 'Welcome curry');
    await action(owner, { action: 'invite', book: catalog.defaultBookId, value: 'contribute' });
    const details = await (await owner.get(`/api/books?book=${catalog.defaultBookId}`)).json();
    const path = `/books/join/${details.invitations[0].token}`;
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    const email = `new-book-member-${randomUUID()}@example.test`;
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    await expect(page.getByLabel('Sign-in code', { exact: true })).toBeVisible();
    const code = (await (await page.request.get('/api/dev/inbox')).json()).find(
      (mail: { email: string }) => mail.email === email
    ).code;
    await page.getByLabel('Sign-in code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(path));
    await page.locator('a[href^="/household?next="]').click();
    await page.getByLabel('Household name').fill('New home');
    await page.getByRole('button', { name: 'Create household', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(path));
    await page.getByRole('button', { name: 'Accept for our household' }).click();
    await expect(page.locator('.wp-recipe')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Welcome curry', exact: true })).toBeVisible();
  } finally {
    await owner.dispose();
  }
});

test('a refresh arriving during editing cannot turn a concurrent edit into a duplicate recipe', async ({
  page
}) => {
  const initial = await setup(page.request, 'Concurrent kitchen');
  const catalog = await addRecipe(page.request, initial.defaultBookId, 'Original curry');
  await page.goto('/?view=recipes');
  await expect(page.locator('.wp-recipe')).toHaveCount(1);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const pending = new Promise<void>((resolve) => (started = resolve));
  let hold = true;
  await page.route('**/api/books', async (route) => {
    if (route.request().method() === 'GET' && hold) {
      hold = false;
      started();
      await held;
      const response = await route.fetch();
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pending;
  await page.getByRole('button', { name: 'Edit recipe Original curry', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('My unsaved edit');
  const shared = catalog.recipes[0];
  await action(page.request, {
    action: 'save',
    book: shared.bookId,
    recipe: { ...shared.recipe, name: 'Another cook’s edit' },
    image: shared.image,
    revision: shared.revision
  });
  const refreshed = page.waitForResponse(
    (response) => response.url().endsWith('/api/books') && response.request().method() === 'GET'
  );
  release();
  await (await refreshed).finished();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This recipe changed. Close it and reopen it before saving.'
  );
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('My unsaved edit');
  const saved = await (await page.request.get('/api/books')).json();
  expect(saved.recipes).toHaveLength(1);
  expect(saved.recipes[0].recipe.name).toBe('Another cook’s edit');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit recipe Another cook’s edit', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Another cook’s edit');
});
