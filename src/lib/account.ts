import type { Locale } from './i18n/messages';
export type Household = { id: string; name: string; role: 'owner' | 'member' };
export type Account = {
  locale?: Locale | null;
  user: { id: string; email: string; name: string };
  household: Household | null;
};
