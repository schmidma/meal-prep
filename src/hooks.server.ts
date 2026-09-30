import { detectLocale, isLocale } from '$lib/i18n/messages';
import { building, dev } from '$app/environment';
import { json, redirect, type Handle } from '@sveltejs/kit';
import { getAuth, testInboxEnabled } from '$lib/server/auth';
import { households } from '$lib/server/households';
import { svelteKitHandler } from 'better-auth/svelte-kit';
export const handle: Handle = async ({ event, resolve: resolvePage }) => {
  const savedLanguage = event.cookies.get('meal-prep-language');
  const language = isLocale(savedLanguage)
    ? savedLanguage
    : detectLocale(event.request.headers.get('accept-language'));
  const resolve: typeof resolvePage = (requestEvent, options) =>
    resolvePage(requestEvent, {
      ...options,
      transformPageChunk: ({ html }) =>
        html.replace('<html lang="en">', `<html lang="${language}">`)
    });
  if (building) return resolve(event);
  const path = event.url.pathname;
  if (path.startsWith('/api/dev/')) {
    const local =
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(event.getClientAddress()) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(event.url.hostname);
    if (!dev || !testInboxEnabled() || !local) return new Response('Not found', { status: 404 });
    const origin = event.request.headers.get('origin');
    if (
      (origin && origin !== event.url.origin) ||
      event.request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return new Response('Forbidden', { status: 403 });
    return resolve(event);
  }
  if (path === '/sign-in' || path.startsWith('/join/')) return resolve(event);
  if (path.startsWith('/classic')) redirect(303, '/');
  if (!path.startsWith('/api/')) return resolve(event);
  const auth = await getAuth();
  if (path.startsWith('/api/auth/')) {
    const headers = new Headers(event.request.headers);
    headers.set('x-meal-prep-client-ip', event.getClientAddress());
    event.request = new Request(event.request, { headers });
    return svelteKitHandler({ event, resolve, auth, building });
  }
  const session = await auth.api.getSession({ headers: event.request.headers });
  if (!session)
    return json(
      { error: 'Please sign in.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  event.locals.user = session.user;
  event.locals.household = households().household(session.user.id) ?? undefined;
  const expectedUser = event.request.headers.get('x-meal-prep-user');
  const expectedHousehold = event.request.headers.get('x-meal-prep-household');
  if (
    (expectedUser !== null && expectedUser !== event.locals.user.id) ||
    (expectedHousehold !== null && expectedHousehold !== (event.locals.household?.id ?? 'none'))
  ) {
    return json(
      { error: 'Your account or household changed. Reload before continuing.' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    if (
      event.request.headers.get('origin') !== event.url.origin ||
      event.request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return json({ error: 'Forbidden' }, { status: 403 });
  }
  if ((path.startsWith('/api/plan') || path.startsWith('/api/photos')) && !event.locals.household)
    return json({ error: 'Create or join a household first.' }, { status: 403 });
  const response = await resolve(event);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
