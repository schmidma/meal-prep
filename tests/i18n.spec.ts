import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signIn, householdAction } from './auth-helpers';

test('browser language, language switching and translated sign-in', async ({
  browser
}, testInfo) => {
  const context = await browser.newContext({
    locale: 'de-DE',
    viewport: testInfo.project.use.viewport
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/sign-in');
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('E-Mail-Adresse')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await page.screenshot({ path: `/tmp/i18n-sign-in-${testInfo.project.name}.png`, fullPage: true });
  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
  await context.close();
});

test('personal language persists while household content and custom sections stay unchanged', async ({
  page
}, testInfo) => {
  await signIn(page.request, `language-${randomUUID()}@example.test`);
  expect(
    (await householdAction(page.request, { action: 'create', name: 'Unser Zuhause' })).ok()
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Custom section name').fill('Second lunch');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const original = (await (await page.request.get('/api/plan')).json()).plan;
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
  await expect(page.getByLabel('Sprache', { exact: true })).toHaveValue('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  expect((await (await page.request.get('/api/account')).json()).locale).toBe('de');
  expect((await (await page.request.get('/api/plan')).json()).plan).toEqual(original);
  await expect(page.getByLabel('Abschnittsname Second lunch', { exact: true })).toHaveValue(
    'Second lunch'
  );
  await page.screenshot({
    path: `/tmp/i18n-settings-${testInfo.project.name}.png`,
    fullPage: true
  });
  await page.context().clearCookies({ name: 'meal-prep-language' });
  await page.reload();
  await expect(page.getByLabel('Sprache', { exact: true })).toHaveValue('de');
  await page.getByRole('button', { name: /^Rezepte/ }).click();
  await page.getByRole('button', { name: 'Erstes Rezept speichern', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await page.screenshot({ path: `/tmp/i18n-recipe-${testInfo.project.name}.png`, fullPage: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Grandma’s Kartoffeln');
  await dialog.getByRole('combobox', { name: 'Zutat 1', exact: true }).fill('2 Dosen Kichererbsen');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Grandma’s Kartoffeln', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  const saved = await (await page.request.get('/api/books')).json();
  expect(saved.recipes[0].recipe.ingredients[0]).toMatchObject({
    name: 'Kichererbsen',
    unit: 'Dosen',
    quantity: 2
  });
  await page.getByRole('button', { name: 'Einkauf', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Einkaufsliste', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Essensplan', exact: true }).click();
  await page.screenshot({ path: `/tmp/i18n-agenda-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Grandma’s Kartoffeln', exact: true })
  ).toBeVisible();
});

test('a failed language save keeps the current language and shows a translated retry message', async ({
  page
}) => {
  await signIn(page.request, `language-failure-${randomUUID()}@example.test`);
  await householdAction(page.request, { action: 'create', name: 'Home' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(page.getByLabel('Sprache', { exact: true })).toHaveValue('de');
  await page.route('**/api/account', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    else await route.continue();
  });
  await page.getByLabel('Sprache', { exact: true }).selectOption('en');
  await expect(page.getByRole('alert')).toHaveText(
    'Deine Sprache konnte nicht gespeichert werden. Versuche es erneut.'
  );
  await expect(page.getByLabel('Sprache', { exact: true })).toHaveValue('de');
  expect((await (await page.request.get('/api/account')).json()).locale).toBe('de');
});

test('language can change after signing out before creating a household', async ({ page }) => {
  await signIn(page.request, `language-signout-${randomUUID()}@example.test`);
  await page.goto('/household');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('Language', { exact: true }).selectOption('de');
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
});
