import { afterEach, describe, expect, it } from 'vitest';
import { CONTRASTS, isContrast, storeContrast, storedContrast } from './contrast.js';
import { fakeStorage, restoreStorage } from './test-storage.js';

const KEY = 'dsh-mobile.contrast';

afterEach(() => {
  restoreStorage();
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
