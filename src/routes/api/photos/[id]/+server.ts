import type { RequestHandler } from '@sveltejs/kit';
import { readPhoto } from '$lib/server/photo-store';
export const GET: RequestHandler = async ({ params, locals }) => {
  const photo = await readPhoto(params.id ?? '', locals.household!.id);
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
