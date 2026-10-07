import { json, type RequestHandler } from '@sveltejs/kit';
import { recipeBooks, BookError } from '$lib/server/recipe-books';
import { households } from '$lib/server/households';
function failure(error: unknown) {
  if (!(error instanceof BookError)) console.error('Recipe books request failed', error);
  return json(
    { error: error instanceof BookError ? error.message : 'Unable to update recipe books.' },
    { status: error instanceof BookError ? error.status : 500 }
  );
}
export const GET: RequestHandler = ({ locals, url }) => {
  try {
    const store = recipeBooks();
    const token = url.searchParams.get('invitation');
    if (token) return json(store.invitation(token));
    const book = url.searchParams.get('book');
    if (book) {
      const details = store.details(locals.household!, book);
      return json({
        ...details,
        access: (details.access as { household: string; permission: string }[]).map((a) => ({
          ...a,
          name: households().name(a.household)
        }))
      });
    }
    return json(store.catalog(locals.household!));
  } catch (error) {
    return failure(error);
  }
};
export const POST: RequestHandler = async ({ locals, request }) => {
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
        if (size > 512 * 1024)
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
    let body;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return json({ error: 'Invalid request.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object')
      return json({ error: 'Invalid request.' }, { status: 400 });
    const { action, book, value, recipe, image, revision, id } = body;
    const store = recipeBooks();
    const household = locals.household!;
    if (action === 'create') store.create(household, value);
    else if (action === 'join' && typeof value === 'string') store.join(household, value);
    else if (action === 'save' && typeof book === 'string')
      store.save(household, book, recipe, image, revision);
    else if (action === 'remove-recipe' && typeof id === 'string' && Number.isSafeInteger(revision))
      store.removeRecipe(household, id, revision);
    else if (typeof book === 'string' && (value === undefined || typeof value === 'string'))
      store.change(household, action, book, value ?? '');
    else return json({ error: 'Invalid request.' }, { status: 400 });
    return json(store.catalog(household));
  } catch (error) {
    return failure(error);
  }
};
