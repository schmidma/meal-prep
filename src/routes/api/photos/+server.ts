import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_PHOTO_BYTES, storePhoto } from '$lib/server/photo-store';
export const POST: RequestHandler = async ({ request, url, locals }) => {
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
    return json({ error: 'Forbidden' }, { status: 403 });
  if (request.headers.get('content-type') !== 'image/jpeg')
    return json({ error: 'Expected a JPEG photo.' }, { status: 415 });
  if (Number(request.headers.get('content-length')) > MAX_PHOTO_BYTES)
    return json(
      { error: 'Photo is too large.' },
      { status: 413, headers: { Connection: 'close' } }
    );
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Choose a photo.' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES)
        return json(
          { error: 'Photo is too large.' },
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
  try {
    return json({ id: await storePhoto(bytes, locals.household!.id) }, { status: 201 });
  } catch {
    return json({ error: 'Could not save this photo. Try another image.' }, { status: 400 });
  }
};
