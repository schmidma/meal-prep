import type { Account } from './account';
// Per-tab context, used only as a consistency check; the server authorizes from its session.
let account: Account | null = null;
export function setAccountContext(value: Account) {
  account = value;
}
export function accountFetch(value: Account): typeof fetch {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('X-Meal-Prep-User', value.user.id);
    headers.set('X-Meal-Prep-Household', value.household?.id ?? 'none');
    return fetch(input, { ...init, headers });
  };
}
export const householdFetch: typeof fetch = (input, init) => {
  if (!account) return Promise.reject(new Error('Wait for your household to load.'));
  return accountFetch(account)(input, init);
};
