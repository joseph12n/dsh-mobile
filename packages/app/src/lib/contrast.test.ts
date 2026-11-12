import { afterEach, describe, expect, it } from 'vitest';
import { CONTRASTS, isContrast, storeContrast, storedContrast } from './contrast.js';

/**
 * The contrast choice.
 *
 * Three levels and a memory. The cases worth pinning are the cheap ones: an unknown
 * stored value must not break the app, and a storage that throws must not either —
 * `localStorage` throws in private modes and inside some webviews, which is exactly
 * where a phone PWA runs.
 */

const KEY = 'dsh-mobile.contrast';
const original = globalThis.localStorage;

/** A `localStorage` good enough for the module, in a Node environment. */
function fakeStorage(options: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): void {
  const data = new Map<string, string>();

  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem(key: string): string | null {
      if (options.throwOnGet) throw new Error('denied');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (options.throwOnSet) throw new Error('full');
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    clear(): void {
      data.clear();
    },
  };
}

afterEach(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = original;
});

describe('reading the stored level', () => {
  it('is normal by default', () => {
    fakeStorage();
    expect(storedContrast()).toBe('normal');
  });

  it('reads what was stored', () => {
    fakeStorage();
    storeContrast('high');
    expect(storedContrast()).toBe('high');
  });

  it('ignores a value it does not know', () => {
    // Una version futura, o alguien tocando la consola.
    fakeStorage();
    globalThis.localStorage.setItem(KEY, 'ultra');
    expect(storedContrast()).toBe('normal');
  });

  it('survives a storage that throws on read', () => {
    fakeStorage({ throwOnGet: true });
    expect(storedContrast()).toBe('normal');
  });

  it('survives a storage that refuses to write', () => {
    fakeStorage({ throwOnSet: true });
    expect(() => storeContrast('high')).not.toThrow();
  });

  it('survives having no storage at all', () => {
    // Un webview sin `localStorage` no puede impedir ver la app.
    (globalThis as unknown as { localStorage: unknown }).localStorage = undefined;
    expect(storedContrast()).toBe('normal');
    expect(() => storeContrast('low')).not.toThrow();
  });
});

describe('the levels', () => {
  it('accepts exactly the three it defines', () => {
    for (const level of CONTRASTS) expect(isContrast(level)).toBe(true);
    expect(isContrast('normal ')).toBe(false);
    expect(isContrast('')).toBe(false);
    expect(isContrast(undefined)).toBe(false);
    expect(isContrast(3)).toBe(false);
  });
});
