import { json, type RequestHandler } from '@sveltejs/kit';
import { households, HouseholdError } from '$lib/server/households';
function failure(error: unknown) {
  return json(
    { error: error instanceof HouseholdError ? error.message : 'Unable to update household.' },
    { status: error instanceof HouseholdError ? error.status : 500 }
  );
}
export const GET: RequestHandler = ({ locals, url }) => {
  try {
    const token = url.searchParams.get('invitation');
    return json(token ? households().invitation(token) : households().details(locals.user!.id));
  } catch (error) {
    return failure(error);
  }
};
export const POST: RequestHandler = async ({ request, locals, url }) => {
  try {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      return json({ error: 'Expected JSON.' }, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Invalid request.' }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096)
          return json(
            { error: 'Request too large.' },
            { status: 413, headers: { Connection: 'close' } }
          );
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body = new TextDecoder().decode(bytes);
    const { action, name, token, target } = JSON.parse(body);
    const user = locals.user!;
    switch (action) {
      case 'create':
        return json(households().create(user.id, user.email, typeof name === 'string' ? name : ''));
      case 'join':
        return json(households().join(user.id, user.email, typeof token === 'string' ? token : ''));
      case 'invite':
        return json({ url: `${url.origin}/join/${households().invite(user.id)}` });
      case 'rename':
      case 'remove':
      case 'promote':
      case 'demote':
      case 'revoke':
      case 'revoke-invite':
      case 'leave':
        households().manage(user.id, action, typeof target === 'string' ? target : '');
        return json({ ok: true });
      default:
        return json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid request.' }, { status: 400 });
    return failure(error);
  }
};
