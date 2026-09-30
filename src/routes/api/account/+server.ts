import { json, type RequestHandler } from '@sveltejs/kit';
import { households } from '$lib/server/households';
import { isLocale } from '$lib/i18n/messages';
export const GET: RequestHandler = ({ locals }) =>
  json({
    user: locals.user,
    household: locals.household ?? null,
    locale: households().locale(locals.user!.id)
  });
export const PATCH: RequestHandler = async ({ locals, request }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid language.' }, { status: 400 });
  }
  if (!isLocale(body?.locale)) return json({ error: 'Invalid language.' }, { status: 400 });
  households().setLocale(locals.user!.id, body.locale);
  return json({ locale: body.locale });
};
