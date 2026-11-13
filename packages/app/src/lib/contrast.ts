import { useCallback, useEffect, useState } from 'react';

export const CONTRASTS = ['normal', 'high', 'low'] as const;
export type Contrast = (typeof CONTRASTS)[number];

const STORAGE_KEY = 'dsh-mobile.contrast';

export function isContrast(value: unknown): value is Contrast {
  return typeof value === 'string' && (CONTRASTS as readonly string[]).includes(value);
}

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
  } catch {}
}

export function applyContrast(contrast: Contrast): void {
  try {
    document.documentElement.dataset['contrast'] = contrast;
  } catch {}
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
