import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { signIn, householdAction, origin } from './auth-helpers';

async function action(request: APIRequestContext, data: object) {
  const response = await request.post('/api/books', { headers: { origin }, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('image variants cache without bypassing household and shared-book access', async ({
  request,
  browser
}) => {
  await signIn(request, `photos-${randomUUID()}@example.test`);
  await householdAction(request, { action: 'create', name: 'Photo owner' });
  const catalog = await (await request.get('/api/books')).json();
  const jpeg = await sharp('static/images/food/chickpea-curry.png').jpeg().toBuffer();
  const upload = await request.post('/api/photos', {
    headers: { origin, 'content-type': 'image/jpeg' },
    data: jpeg
  });
  expect(upload.status()).toBe(201);
  const { id } = await upload.json();
  const url = `/api/photos/${id}?size=320`;
  const first = await request.get(url);
  expect(first.status()).toBe(200);
  expect(first.headers()['cache-control']).toBe('private, no-cache');
  expect(first.headers().vary).toBe('Cookie');
  const small = await first.body();
  expect((await sharp(small).metadata()).width).toBeLessThanOrEqual(320);
  expect(small.length).toBeLessThan(jpeg.length / 2);
  const headers = { 'if-none-match': first.headers().etag };
  const cached = await request.get(url, { headers });
  expect(cached.status()).toBe(304);
  expect((await cached.body()).length).toBe(0);
  expect((await request.get(`/api/photos/${id}?size=640`, { headers })).status()).toBe(200);
  expect((await request.get(`/api/photos/${id}?size=999`)).status()).toBe(400);
  expect((await request.get('/api/books')).headers()['cache-control']).toContain('no-store');
  const friend = await browser.newContext();
  try {
    expect((await friend.request.get(url, { headers })).status()).toBe(401);
    await signIn(friend.request, `photos-friend-${randomUUID()}@example.test`);
    await householdAction(friend.request, { action: 'create', name: 'Photo friend' });
    expect((await friend.request.get(url, { headers })).status()).toBe(404);
    await action(request, {
      action: 'save',
      book: catalog.defaultBookId,
      revision: 0,
      image: id,
      recipe: {
        id: randomUUID(),
        name: 'Curry',
        yieldQuantity: 4,
        durationMinutes: 30,
        instructions: '',
        ingredients: []
      }
    });
    await action(request, { action: 'invite', book: catalog.defaultBookId, value: 'view' });
    const details = await (await request.get(`/api/books?book=${catalog.defaultBookId}`)).json();
    await action(friend.request, { action: 'join', value: details.invitations[0].token });
    expect((await friend.request.get(url)).status()).toBe(200);
    expect((await friend.request.get(url, { headers })).status()).toBe(304);
    await action(friend.request, { action: 'leave', book: catalog.defaultBookId });
    const revoked = await friend.request.get(url, { headers });
    expect(revoked.status()).toBe(404);
    expect(revoked.headers()['cache-control']).toContain('no-store');
  } finally {
    await friend.close();
  }
});
