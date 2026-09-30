import { expect, it } from 'vitest';
import { isPhotoId, photoUrl } from './food-photos';
import { createStarterPlan } from '../../tests/fixtures/plans';
import { parseKitchenPlan } from './plan-document';
it('uses illustrations by default and restricts stored photo references', () => {
  expect(photoUrl(undefined)).toBe('/images/illustrations/bowl.webp');
  expect(photoUrl('sketch-soup')).toBe('/images/illustrations/soup.webp');
  expect(photoUrl('chickpea-curry')).toBe('/images/food/chickpea-curry.png');
  const upload = `upload-${'a'.repeat(64)}`;
  expect(photoUrl(upload)).toBe(`/api/photos/${upload}`);
  const plan = createStarterPlan();
  for (const value of [upload, 'sketch-soup', 'sketch-vegetables']) {
    plan.weekly!.images = { [plan.recipes[0].id]: value };
    expect(parseKitchenPlan(plan)).toEqual(plan);
  }
  for (const value of [
    '../../secret',
    'https://example.com/a.jpg',
    'data:image/svg+xml,test',
    'upload-no'
  ]) {
    expect(isPhotoId(value)).toBe(false);
    plan.weekly!.images = { [plan.recipes[0].id]: value };
    expect(() => parseKitchenPlan(plan)).toThrow();
  }
});

it('keeps retired illustration references valid for existing plans', () => {
  const plan = createStarterPlan();
  for (const [old, current] of [
    ['sketch-bread', 'abendbrot'],
    ['sketch-eggs', 'breakfast'],
    ['sketch-fish', 'bowl'],
    ['sketch-chicken', 'bowl'],
    ['sketch-tacos', 'sandwich']
  ]) {
    plan.weekly!.images = { [plan.recipes[0].id]: old };
    expect(parseKitchenPlan(plan)).toEqual(plan);
    expect(photoUrl(old)).toBe(`/images/illustrations/${current}.webp`);
  }
});
