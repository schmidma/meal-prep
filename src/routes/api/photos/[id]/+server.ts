import type { RequestHandler } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { recipeBooks } from '$lib/server/recipe-books';
import { readPhoto } from '$lib/server/photo-store';
export const GET: RequestHandler = async ({ params, locals }) => {
  let photo = await readPhoto(params.id ?? '', locals.household!.id);
  if (!photo) {
    const shared = recipeBooks().sharedPhoto(locals.household!, params.id ?? '');
    if (shared) {
      try {
        photo = await readFile(shared);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  if (!photo) return new Response('Photo not found', { status: 404 });
  return new Response(new Uint8Array(photo), {
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    }
  });
};
