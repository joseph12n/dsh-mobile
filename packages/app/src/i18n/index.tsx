import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CATALOGUES, LOCALES, type Locale, type MessageKey } from './locales.js';

/**
 * Language plumbing.
 *
 * Three rules:
 *  1. The choice is remembered. A phone that forgets the language on every launch is
 *     a phone you configure twice.
 *  2. The first visit follows the browser, so a Spanish speaker does not land in
 *     English.
 *  3. Anything unknown falls back to English rather than to a blank screen.
 */

const STORAGE_KEY = 'dsh-mobile.locale';

/** `true` if the value is one of the languages we ship. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the starting language.
 *
 * `navigator.languages` is tried in order: someone who prefers `pt-BR` but also
 * accepts `en` gets Portuguese, not English.
 *
 * Two mappings are deliberate and worth writing down, because both override an
 * explicit preference:
 *  - **`zh-TW` → `zh-Hans`**: we ship one Chinese script. Serving traditional
 *    readers simplified text is worse than English for them, so a `zh-Hant`
 *    catalogue is the follow-up.
 *  - **`pt-PT` → `pt-BR`**: we ship one Portuguese. The spelling differs but the
 *    language does not, and "mostly right Portuguese" beats English for a pt-PT user.
 */
export function detectLocale(preferred?: readonly string[]): Locale {
  const candidates = preferred ?? [];
  for (const raw of candidates) {
    if (isLocale(raw)) return raw;
    const lower = raw.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-Hans';
    if (lower.startsWith('pt')) return 'pt-BR';
    if (lower.startsWith('en')) return 'en';
    if (lower.startsWith('es')) return 'es';
  }
  return 'en';
}

/** Reads the stored choice, if any. Never throws: a blocked storage is not fatal. */
export function storedLocale(): Locale | undefined {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Private mode or a full quota: the language still applies to this session.
  }
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Replaces `{name}` with the given value. Unknown placeholders are left alone. */
export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** Builds the translate function for a language. */
export function translator(locale: Locale): Translate {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES.en;
  return (key, values) => interpolate(catalogue[key] ?? CATALOGUES.en[key] ?? key, values);
}

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [locale, setLocaleState] = useState<Locale>(
    () => storedLocale() ?? detectLocale(globalThis.navigator?.languages),
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  // `document.documentElement.lang` drives the screen reader voice and the browser's
  // offer to translate. Leaving it at the value in index.html tells a screen reader to
  // read Chinese with a Spanish voice.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t: translator(locale) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The current language and its translator. */
export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value) return value;

  // Outside a provider (a component rendered alone in a test) English is a better
  // answer than a crash.
  return { locale: 'en', setLocale: () => undefined, t: translator('en') };
}

/**
 * `1 tool` / `2 tools`.
 *
 * The plural key is derived, so it is checked at runtime: a key **without** a
 * `_plural` sibling would otherwise render `session.tools_plural` literally on
 * screen, and the type system cannot see that. Falling back to the singular is wrong
 * grammatically but it is English, not a raw key.
 */
export function plural(
  t: Translate,
  key: MessageKey,
  count: number,
  values: Record<string, string | number> = {},
): string {
  const pluralKey = `${key}_plural` as MessageKey;
  const hasPlural = pluralKey in CATALOGUES.en;
  const choice = count === 1 || !hasPlural ? key : pluralKey;
  return t(choice, { count, ...values });
}
