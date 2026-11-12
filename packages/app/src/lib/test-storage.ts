/**
 * A `localStorage` good enough for the modules that remember a choice, in a Node
 * environment.
 *
 * Shared by the tests of those modules so two files do not keep two copies of the same
 * helper, and so the "storage throws" case is exercised the same way in both.
 */

const original = globalThis.localStorage;

export interface FakeStorageOptions {
  /** Throws on read, like a private mode that denies access. */
  throwOnGet?: boolean;
  /** Throws on write, like a full quota. */
  throwOnSet?: boolean;
}

export function fakeStorage(options: FakeStorageOptions = {}): void {
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

/** Puts the real (or undefined) `localStorage` back. */
export function restoreStorage(): void {
  (globalThis as unknown as { localStorage: unknown }).localStorage = original;
}
