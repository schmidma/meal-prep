import sharp from 'sharp';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uploadIdPattern } from './photo-store';

export const photoSizes = [320, 640, 1200] as const;
export type PhotoSize = (typeof photoSizes)[number];
export const photoVariantVersion = 'webp-v1';
const pending = new Map<string, Promise<Buffer>>();

// Call only after checking access to the source. Cache files never grant access.
export async function photoVariant(source: string, id: string, size: PhotoSize) {
  if (!uploadIdPattern.test(id) || !photoSizes.includes(size))
    throw new Error('Invalid photo variant');
  const directory = join(
    dirname(resolve(process.env.MEAL_PREP_DB_PATH || 'data/meal-prep.sqlite')),
    'photo-cache'
  );
  const path = join(directory, `${id}-${size}-${photoVariantVersion}.webp`);
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const existing = pending.get(path);
  if (existing) return existing;
  const work = (async () => {
    const bytes = await sharp(source, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return bytes;
  })();
  pending.set(path, work);
  try {
    return await work;
  } finally {
    pending.delete(path);
  }
}
