import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { storePhoto, photoPath } from './photo-store';
import { photoVariant } from './photo-variants';
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
it('generates compact images from existing uploads once without changing the source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'photo-variants-'));
  directories.push(directory);
  vi.stubEnv('MEAL_PREP_DB_PATH', join(directory, 'plan.sqlite'));
  const input = await sharp('static/images/food/chickpea-curry.png')
    .jpeg({ quality: 90 })
    .toBuffer();
  const household = '00000000-0000-0000-0000-000000000000';
  const id = await storePhoto(input, household);
  const source = (await photoPath(id, household))!;
  const [small, concurrent] = await Promise.all([
    photoVariant(source, id, 320),
    photoVariant(source, id, 320)
  ]);
  expect(small).toEqual(concurrent);
  const metadata = await sharp(small).metadata();
  expect(metadata.format).toBe('webp');
  expect(Math.max(metadata.width!, metadata.height!)).toBe(320);
  expect(small.length).toBeLessThan(input.length / 2);
  const cache = join(directory, 'photo-cache');
  const files = await readdir(cache);
  expect(files).toHaveLength(1);
  const before = await stat(join(cache, files[0]));
  expect(await photoVariant(source, id, 320)).toEqual(small);
  expect((await stat(join(cache, files[0]))).mtimeMs).toBe(before.mtimeMs);
  expect((await stat(source)).size).toBe(input.length);
  const large = await sharp(await photoVariant(source, id, 1200)).metadata();
  expect(Math.max(large.width!, large.height!)).toBeLessThanOrEqual(1200);
});
