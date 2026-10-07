import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const uploadIdPattern = /^upload-[a-f0-9]{64}$/;
const directory = (householdId?: string) => {
  const base = dirname(resolve(process.env.MEAL_PREP_DB_PATH || 'data/meal-prep.sqlite'));
  if (householdId && !/^[a-f0-9-]{36}$/.test(householdId)) throw new Error('Invalid household ID');
  return householdId ? join(base, 'households', householdId, 'photos') : join(base, 'photos');
};
export async function storePhoto(bytes: Uint8Array, householdId?: string) {
  if (
    bytes.length > MAX_PHOTO_BYTES ||
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    throw new Error('Expected a JPEG photo under 2 MB.');
  const id = `upload-${createHash('sha256').update(bytes).digest('hex')}`;
  await mkdir(directory(householdId), { recursive: true, mode: 0o700 });
  await writeFile(join(directory(householdId), `${id}.jpg`), bytes, { mode: 0o600 });
  return id;
}
export async function readPhoto(id: string, householdId?: string) {
  if (!uploadIdPattern.test(id)) return undefined;
  try {
    return await readFile(join(directory(householdId), `${id}.jpg`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function photoPath(id: string, householdId: string) {
  if (!uploadIdPattern.test(id)) return undefined;
  const path = join(directory(householdId), `${id}.jpg`);
  try {
    return (await stat(path)).isFile() ? path : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
