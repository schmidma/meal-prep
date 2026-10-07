import { json, type RequestHandler } from '@sveltejs/kit';
import { recipeBooks, BookError } from '$lib/server/recipe-books';
import { retainPlannedRecipes } from '$lib/recipe-books';
import { parseSaveRequest } from '$lib/plan-document';
import { getPlanStore, PlanConflictError } from '$lib/server/plan-store';

const noStore = { 'Cache-Control': 'no-store' };
const MAX_REQUEST_BYTES = 512 * 1024;

function failure(status: number, message: string, unreadBody = false): Response {
  // Do not reuse an HTTP/1 connection with an undrained rejected request body.
  return json(
    { error: message },
    { status, headers: { ...noStore, ...(unreadBody ? { Connection: 'close' } : {}) } }
  );
}

export const GET: RequestHandler = ({ url, locals }) => {
  try {
    return json(getPlanStore(locals.household!.id).load(), { headers: noStore });
  } catch (error) {
    console.error('Failed to load plan', error);
    return failure(500, 'Unable to load plan');
  }
};

export const PUT: RequestHandler = async ({ request, url, locals }) => {
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
    return failure(403, 'Forbidden', true);
  if (
    request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !==
    'application/json'
  )
    return failure(415, 'Expected application/json', true);
  if (request.headers.get('x-meal-prep-storage') !== 'books-v1')
    return failure(409, 'Reload the app before saving after this update.', true);
  const length = request.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_REQUEST_BYTES)
    return failure(413, 'Request too large', true);
  let body = '';
  try {
    const reader = request.body?.getReader();
    if (!reader) return failure(400, 'Invalid request');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_REQUEST_BYTES) {
          // Cancelling SvelteKit's request stream destroys the socket before the
          // response can be sent. Close it with the rejection response instead.
          return failure(413, 'Request too large', true);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    body = new TextDecoder('utf-8', { fatal: true }).decode(combined);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 413)
      return failure(413, 'Request too large', true);
    return failure(400, 'Invalid request', true);
  }
  let save;
  try {
    save = parseSaveRequest(JSON.parse(body));
    if (retainPlannedRecipes(save.plan).recipes.length !== save.plan.recipes.length)
      return failure(
        409,
        'Recipes are now saved in recipe books. Download pending edits before reloading.'
      );
  } catch {
    return failure(400, 'Invalid plan');
  }
  try {
    recipeBooks().retainPhotos(locals.household!, Object.values(save.plan.weekly?.images ?? {}));
    return json(getPlanStore(locals.household!.id).save(save.revision, save.plan), {
      headers: noStore
    });
  } catch (error) {
    if (error instanceof BookError) return failure(error.status, error.message);
    if (error instanceof PlanConflictError) return failure(409, 'Plan revision conflict');
    console.error('Failed to save plan', error);
    return failure(500, 'Unable to save plan');
  }
};
