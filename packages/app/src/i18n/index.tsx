import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CATALOGUES, LOCALES, type Locale, type MessageKey } from './locales.js';

const STORAGE_KEY = 'dsh-mobile.locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

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
  } catch {}
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

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

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t: translator(locale) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value) return value;

  return { locale: 'en', setLocale: () => undefined, t: translator('en') };
}

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
