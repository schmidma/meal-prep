import type { RequestHandler } from '@sveltejs/kit';
import { readFile, stat } from 'node:fs/promises';
import { recipeBooks } from '$lib/server/recipe-books';
import { photoPath } from '$lib/server/photo-store';
import {
  photoSizes,
  photoVariant,
  photoVariantVersion,
  type PhotoSize
} from '$lib/server/photo-variants';

export const GET: RequestHandler = async ({ params, locals, request, url }) => {
  const id = params.id ?? '';
  const requestedSize = url.searchParams.get('size');
  const size = requestedSize === null ? undefined : (Number(requestedSize) as PhotoSize);
  if (size !== undefined && !photoSizes.includes(size))
    return new Response('Invalid image size', { status: 400 });
  let source = await photoPath(id, locals.household!.id);
  if (!source) {
    const shared = recipeBooks().sharedPhoto(locals.household!, id);
    if (shared) {
      try {
        if ((await stat(shared)).isFile()) source = shared;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  if (!source) return new Response('Photo not found', { status: 404 });
  const etag = `"${id}-${size === undefined ? 'original' : `${size}-${photoVariantVersion}`}"`;
  const headers = {
    'Content-Type': size === undefined ? 'image/jpeg' : 'image/webp',
    'X-Content-Type-Options': 'nosniff',
    // Revalidate before reuse so sign-out or revoked book access takes effect immediately.
    'Cache-Control': 'private, no-cache',
    Vary: 'Cookie',
    ETag: etag,
    'Content-Security-Policy': "default-src 'none'; sandbox"
  };
  const matches = request.headers
    .get('if-none-match')
    ?.split(',')
    .some((value) => {
      const tag = value.trim().replace(/^W\//, '');
      return tag === etag || tag === '*';
    });
  if (matches) return new Response(null, { status: 304, headers });
  const photo = size === undefined ? await readFile(source) : await photoVariant(source, id, size);
  return new Response(new Uint8Array(photo), { headers });
};
