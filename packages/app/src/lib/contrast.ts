import { useCallback, useEffect, useState } from 'react';

/**
 * How much contrast the app shows.
 *
 * Three levels, because two would be a guess:
 *
 *  - **normal** — the DeepSeek Harness palette, which is what the desktop looks like.
 *  - **high** — brighter text, stronger borders and a darker base, for sunlight and for
 *    eyes that need the separation. This is the accessibility case.
 *  - **low** — softer text and softer borders, for reading in the dark without the
 *    screen glaring. It is the opposite need and it deserves its own setting rather
 *    than being told to turn the brightness down.
 *
 * The choice lives in `localStorage` and is applied as `data-contrast` on the root, so
 * the stylesheet decides what each level means and this file only remembers the name.
 */

export const CONTRASTS = ['normal', 'high', 'low'] as const;
export type Contrast = (typeof CONTRASTS)[number];

const STORAGE_KEY = 'dsh-mobile.contrast';

export function isContrast(value: unknown): value is Contrast {
  return typeof value === 'string' && (CONTRASTS as readonly string[]).includes(value);
}

/** The stored choice, or `normal`. A storage that throws is not a reason to fail. */
export function storedContrast(): Contrast {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isContrast(value) ? value : 'normal';
  } catch {
    return 'normal';
  }
}

export function storeContrast(contrast: Contrast): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, contrast);
  } catch {
    // Sin persistencia se sigue viendo bien; solo no se recuerda.
  }
}

/** Applies the level to the document so the CSS variables switch. */
export function applyContrast(contrast: Contrast): void {
  try {
    document.documentElement.dataset['contrast'] = contrast;
  } catch {
    // Un entorno sin documento (una prueba, un render en servidor) no lo necesita.
  }
}

export interface ContrastState {
  contrast: Contrast;
  setContrast: (next: Contrast) => void;
}

export function useContrast(): ContrastState {
  const [contrast, setContrastState] = useState<Contrast>(storedContrast);

  const setContrast = useCallback((next: Contrast) => {
    setContrastState(next);
    storeContrast(next);
  }, []);

  useEffect(() => {
    applyContrast(contrast);
  }, [contrast]);

  return { contrast, setContrast };
}
