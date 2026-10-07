import { test as base } from '@playwright/test';
import { signIn, householdAction, origin } from './auth-helpers';
import { randomUUID } from 'node:crypto';
import { test, expect } from './weekly-fixtures';

test('recipe photos upload, survive reload and can be replaced with an illustration', async ({
  page
}, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Photo recipe');
  await page.getByRole('button', { name: 'Change image', exact: true }).click();
  const picker = page.locator('.wp-photo-editor');
  await picker
    .getByLabel('Upload photo', { exact: true })
    .setInputFiles('static/images/food/chickpea-curry.png');
  await expect(picker.getByAltText('Recipe preview')).toHaveAttribute(
    'src',
    /\/api\/photos\/upload-/
  );
  const url = await picker.getByAltText('Recipe preview').getAttribute('src');
  const response = await page.request.get(url!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/webp');
  await page.screenshot({ path: `/tmp/recipe-photo-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Back to details', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await expect(page.getByAltText('Photo recipe', { exact: true })).toHaveAttribute('src', url!);
  await page.getByRole('button', { name: 'Edit recipe Photo recipe', exact: true }).click();
  await page.getByRole('button', { name: 'Change image', exact: true }).click();
  await picker.getByRole('button', { name: 'Use Vegetables illustration', exact: true }).click();
  await page.getByRole('button', { name: 'Back to details', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByAltText('Photo recipe', { exact: true })).toHaveAttribute(
    'src',
    '/images/illustrations/vegetables.webp'
  );
});

test('photo upload errors keep the current illustration and allow retry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe' }).click();
  await page.getByRole('button', { name: 'Change image', exact: true }).click();
  await page.route('**/api/photos', (route) =>
    route.fulfill({ status: 500, json: { error: 'Upload failed. Try again.' } })
  );
  await page
    .getByLabel('Upload photo', { exact: true })
    .setInputFiles('static/images/food/chickpea-curry.png');
  await expect(page.getByRole('alert')).toHaveText('Upload failed. Try again.');
  await expect(page.getByAltText('Recipe preview')).toHaveAttribute(
    'src',
    '/images/illustrations/bowl.webp'
  );
  await expect(page.getByRole('button', { name: 'Upload photo', exact: true })).toBeEnabled();
});

base(
  'photo endpoint rejects cross-site requests, oversized bodies and non-images',
  async ({ request }) => {
    await signIn(request, `photo-${randomUUID()}@example.test`);
    await householdAction(request, { action: 'create', name: 'Photo tests' });
    expect(
      (
        await request.post('/api/photos', {
          headers: { origin: 'https://elsewhere.invalid', 'content-type': 'image/jpeg' },
          data: 'no'
        })
      ).status()
    ).toBe(403);
    expect(
      (
        await request.post('/api/photos', {
          headers: { origin, 'content-type': 'image/svg+xml' },
          data: '<svg/>'
        })
      ).status()
    ).toBe(415);
    expect(
      (
        await request.post('/api/photos', {
          headers: { origin, 'content-type': 'image/jpeg' },
          data: 'not a photo'
        })
      ).status()
    ).toBe(400);
    expect(
      (
        await request.post('/api/photos', {
          headers: { origin, 'content-type': 'image/jpeg' },
          data: Buffer.alloc(2 * 1024 * 1024 + 1)
        })
      ).status()
    ).toBe(413);
    expect((await request.get('/api/photos/not-a-photo')).status()).toBe(404);
  }
);

test('expanded illustration collection previews and saves a choice', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Recipes/ }).click();
  await page.getByRole('button', { name: 'Add a recipe' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Berry cake');
  await page.getByRole('button', { name: 'Change image', exact: true }).click();
  await expect(page.getByRole('button', { name: /All .* illustrations/ })).toHaveCount(0);
  await expect(page.getByText('Method', { exact: true })).toHaveCount(0);
  const gallery = page.getByRole('group', { name: 'Illustrations', exact: true });
  for (const img of await gallery.locator('img').all()) {
    await expect(img).toHaveJSProperty('complete', true);
    expect(await img.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(
      0
    );
  }
  await gallery.screenshot({ path: `/tmp/meal-illustrations-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Use Desserts illustration', exact: true }).click();
  await page.getByRole('button', { name: 'Back to details', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit recipe Berry cake', exact: true }).click();
  await page.getByRole('button', { name: 'Change image', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Use Desserts illustration', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByAltText('Recipe preview')).toHaveAttribute(
    'src',
    '/images/illustrations/dessert.webp'
  );
});
