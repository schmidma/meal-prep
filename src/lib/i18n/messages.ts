import { IntlMessageFormat } from 'intl-messageformat';
import en from './en.json';
import de from './de.json';
export const languages = {
  en: { name: 'English', tag: 'en-GB' },
  de: { name: 'Deutsch', tag: 'de-DE' }
} as const;
export type Locale = keyof typeof languages;
export type MessageKey = keyof typeof en;
export type Values = Record<string, string | number | boolean | Date>;
export const catalogs: Record<Locale, Record<MessageKey, string>> = { en, de };
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(languages, value);
}
export function detectLocale(header: string | null | undefined): Locale {
  const preferred = (header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...options] = part.trim().split(';');
      const q = options.find((option) => option.trim().startsWith('q='));
      return {
        tag: tag.toLowerCase().split('-')[0],
        weight: q ? Number(q.trim().slice(2)) : 1,
        index
      };
    })
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return (preferred.find((item) => isLocale(item.tag))?.tag as Locale) || 'en';
}
const formats = new Map<string, IntlMessageFormat>();
export function translate(locale: Locale, key: MessageKey, values: Values = {}): string {
  const cacheKey = `${locale}:${key}`;
  let format = formats.get(cacheKey);
  if (!format) {
    format = new IntlMessageFormat(catalogs[locale][key] ?? en[key], locale, undefined, {
      ignoreTag: true
    });
    formats.set(cacheKey, format);
  }
  return String(format.format(values));
}
export const englishMessageKeys = new Map(
  Object.entries(en).map(([key, value]) => [value, key as MessageKey])
);
