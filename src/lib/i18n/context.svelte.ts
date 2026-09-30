import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';
import {
  catalogs,
  languages,
  englishMessageKeys,
  isLocale,
  translate,
  type Locale,
  type MessageKey,
  type Values
} from './messages';
import type { Account } from '$lib/account';
const context = Symbol('meal-prep-language');
export class I18n {
  locale = $state<Locale>('en');
  private account: string | null = null;
  constructor(locale: Locale) {
    this.locale = locale;
  }
  get tag() {
    return languages[this.locale].tag;
  }
  t = (key: MessageKey, values: Values = {}) => translate(this.locale, key, values);
  number = (value: number) => new Intl.NumberFormat(this.tag).format(value);
  date = (value: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(this.tag, options).format(value);
  message = (value: string) => {
    const key = englishMessageKeys.get(value);
    return key ? this.t(key) : value;
  };
  error = (value: string) => {
    if (!value) return '';
    const key = englishMessageKeys.get(value);
    if (key) return this.t(key);
    if (this.locale === 'en' || Object.values(catalogs[this.locale]).includes(value)) return value;
    return this.t('common.unexpectedError');
  };
  section = (section: { id: string; name: string }) =>
    section.id === section.name && ['Breakfast', 'Lunch', 'Dinner'].includes(section.id)
      ? this.t(`sections.${section.id.toLowerCase()}` as MessageKey)
      : section.name;
  private apply(locale: Locale) {
    this.locale = locale;
    if (browser) {
      document.documentElement.lang = locale;
      document.cookie = `meal-prep-language=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    }
  }
  async setLocale(locale: Locale) {
    if (!isLocale(locale)) return;
    // Only apply an account preference once it is durably saved.
    if (this.account) {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-meal-prep-user': this.account },
        body: JSON.stringify({ locale })
      });
      if (!response.ok) throw new Error(this.t('language.saveFailed'));
    }
    this.apply(locale);
  }
  clearAccount() {
    this.account = null;
  }
  async loadAccount(account: Account) {
    this.account = account.user.id;
    if (isLocale(account.locale)) this.apply(account.locale);
    else this.apply(this.locale);
  }
}
export function provideI18n(locale: Locale) {
  return setContext(context, new I18n(locale));
}
export function useI18n(): I18n {
  return getContext(context);
}
