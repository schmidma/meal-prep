export const foodPhotos = [
  { id: 'chickpea-curry', name: 'Chickpea curry' },
  { id: 'lemon-pasta', name: 'Lemon & pea pasta' },
  { id: 'tomato-soup', name: 'Roasted tomato soup' },
  { id: 'roasted-vegetables', name: 'Roasted vegetable bowls' }
];
export const foodIllustrations = [
  { id: 'sketch-bowl', name: 'Meal bowl' },
  { id: 'sketch-soup', name: 'Soup & stew' },
  { id: 'sketch-pasta', name: 'Pasta & noodles' },
  { id: 'sketch-rice', name: 'Rice & grains' },
  { id: 'sketch-salad', name: 'Salad' },
  { id: 'sketch-vegetables', name: 'Vegetables' },
  { id: 'sketch-curry', name: 'Curry' },
  { id: 'sketch-sandwich', name: 'Sandwiches & wraps' },
  { id: 'sketch-pizza', name: 'Pizza & savoury baking' },
  { id: 'sketch-abendbrot', name: 'Abendbrot' },
  { id: 'sketch-breakfast', name: 'Breakfast' },
  { id: 'sketch-dessert', name: 'Desserts' }
];
// Keep old saved references readable without offering retired categories.
const legacyIllustrations: Record<string, string> = {
  'sketch-tacos': 'sketch-sandwich',
  'sketch-fish': 'sketch-bowl',
  'sketch-chicken': 'sketch-bowl',
  'sketch-eggs': 'sketch-breakfast',
  'sketch-bread': 'sketch-abendbrot'
};
export function illustrationId(id: string | undefined): string {
  const current = id ? (legacyIllustrations[id] ?? id) : 'sketch-bowl';
  return foodIllustrations.some((item) => item.id === current) ? current : 'sketch-bowl';
}
export function isPhotoId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    (foodPhotos.some((p) => p.id === id) ||
      foodIllustrations.some((p) => p.id === id) ||
      Object.hasOwn(legacyIllustrations, id) ||
      /^upload-[a-f0-9]{64}$/.test(id))
  );
}
export function photoUrl(id: string | undefined): string {
  if (id && /^upload-[a-f0-9]{64}$/.test(id)) return `/api/photos/${id}`;
  if (foodPhotos.some((photo) => photo.id === id)) return `/images/food/${id}.png`;
  const sketch = illustrationId(id);
  return `/images/illustrations/${sketch.slice(7)}.webp`;
}
