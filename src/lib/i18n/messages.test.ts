import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { catalogs, detectLocale, translate, type MessageKey } from './messages';

describe('UI translation catalogs', () => {
  it('has the same keys and interpolation arguments in every language', () => {
    const keys = Object.keys(catalogs.en).sort();
    function argumentsOf(nodes: ReturnType<IntlMessageFormat['getAst']>): string[] {
      const args = new Set<string>();
      function visit(items: any[]) {
        for (const item of items) {
          if (item.type !== 0 && typeof item.value === 'string') args.add(item.value);
          if (item.options)
            for (const option of Object.values(item.options) as { value: any[] }[])
              visit(option.value);
          if (item.children) visit(item.children);
        }
      }
      visit(nodes);
      return [...args].sort();
    }
    for (const [locale, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog).sort(), locale).toEqual(keys);
      for (const key of keys as MessageKey[]) {
        const original = new IntlMessageFormat(catalogs.en[key], 'en', undefined, {
          ignoreTag: true
        });
        const translated = new IntlMessageFormat(catalog[key], locale, undefined, {
          ignoreTag: true
        });
        expect(catalog[key].trim(), `${locale}:${key}`).not.toBe('');
        expect(argumentsOf(translated.getAst()), `${locale}:${key}`).toEqual(
          argumentsOf(original.getAst())
        );
      }
    }
  });
  it('uses plural rules and locale number formatting without changing content', () => {
    expect(translate('de', 'recipes.portions', { count: 1 })).toBe('1 Portion');
    expect(translate('de', 'recipes.portions', { count: 1.5 })).toBe('1,5 Portionen');
    expect(translate('en', 'recipes.portions', { count: 2 })).toBe('2 portions');
    expect(translate('de', 'planner.source', { name: 'Grandma’s Kartoffeln <3' })).toBe(
      'Aus Grandma’s Kartoffeln <3'
    );
  });
  it('detects supported browser languages by priority with English fallback', () => {
    expect(detectLocale('de-AT,de;q=0.9,en;q=0.8')).toBe('de');
    expect(detectLocale('fr-FR,en-US;q=0.9,de;q=0.8')).toBe('en');
    expect(detectLocale('en;q=0.3,de-DE;q=0.8')).toBe('de');
    expect(detectLocale('de;q=0,en;q=1')).toBe('en');
    expect(detectLocale('fr')).toBe('en');
    expect(detectLocale(null)).toBe('en');
  });
});

// Calls without interpolation values must refer to plain messages. This catches
// accidentally reusing a plural message as a field label before browser testing.
it('does not call parameterized UI messages without values', () => {
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : path.endsWith('.svelte') ? [path] : [];
    });
  }
  for (const path of files('src')) {
    for (const match of readFileSync(path, 'utf8').matchAll(/i18n\.t\('([^']+)'\)/g)) {
      const value = catalogs.en[match[1] as MessageKey];
      expect(value, `${path}: ${match[1]}`).toBeDefined();
      expect(value, `${path}: ${match[1]} needs interpolation values`).not.toContain('{');
    }
  }
});
