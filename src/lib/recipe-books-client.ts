import { householdFetch } from './household-client';
import type { RecipeCatalog } from './recipe-books';
export class BookRequestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export async function bookRequest<T = RecipeCatalog>(
  body?: Record<string, unknown>,
  query = ''
): Promise<T> {
  const response = await householdFetch(
    `/api/books${query}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : { cache: 'no-store' }
  );
  const result = await response.json();
  if (!response.ok)
    throw new BookRequestError(response.status, result.error ?? 'Unable to update recipe books.');
  return result;
}
