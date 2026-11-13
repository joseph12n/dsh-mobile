import { describe, expect, it } from 'vitest';
import { CATALOGUES, LOCALES } from './locales.js';
import { detectLocale, interpolate, isLocale, plural, translator } from './index.js';

describe('catalogue completeness', () => {
  it('every language has every key', () => {
    const keys = Object.keys(CATALOGUES.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(CATALOGUES[locale]).sort(), `locale ${locale}`).toEqual(keys);
    }
  });

  it('no translation is empty or left as the key', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGUES[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
        expect(value, `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('every language keeps the placeholders of the English text', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(CATALOGUES.en)) {
        const translated = CATALOGUES[locale][key as keyof typeof CATALOGUES.en];
        expect(placeholders(translated), `${locale}:${key}`).toEqual(placeholders(value));
      }
    }
  });
});

describe('language detection', () => {
  it('keeps a language it ships', () => {
    expect(detectLocale(['es-AR', 'en'])).toBe('es');
    expect(detectLocale(['pt-BR'])).toBe('pt-BR');
    expect(detectLocale(['zh-Hans'])).toBe('zh-Hans');
  });

  it('maps a Chinese region to the simplified script', () => {
    expect(detectLocale(['zh-CN'])).toBe('zh-Hans');
    expect(detectLocale(['zh-TW'])).toBe('zh-Hans');
  });

  it('prefers the first supported language in the browser order', () => {
    expect(detectLocale(['fr-FR', 'pt-PT', 'en-US'])).toBe('pt-BR');
  });

  it('falls back to English when nothing matches', () => {
    expect(detectLocale(['fr-FR', 'de-DE'])).toBe('en');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale()).toBe('en');
  });

  it('rejects unknown values', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('pt-BR')).toBe(true);
  });
});

describe('translation', () => {
  it('replaces placeholders', () => {
    expect(interpolate('Attempt {attempt}, in {seconds} s.', { attempt: 2, seconds: 4 })).toBe(
      'Attempt 2, in 4 s.',
    );
  });

  it('leaves unknown placeholders alone instead of blanking them', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('translates per language', () => {
    expect(translator('en')('sessions.title')).toBe('Sessions');
    expect(translator('es')('sessions.title')).toBe('Sesiones');
    expect(translator('zh-Hans')('sessions.title')).toBe('会话');
  });

  it('picks the singular or plural form', () => {
    const t = translator('en');
    expect(plural(t, 'session.tools', 1)).toBe('1 tool');
    expect(plural(t, 'session.tools', 3)).toBe('3 tools');
  });

  it('an unknown key does not crash', () => {
    expect(translator('en')('nope' as never)).toBe('nope');
  });
});
