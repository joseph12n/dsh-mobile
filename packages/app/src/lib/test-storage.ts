const original = globalThis.localStorage;

export interface FakeStorageOptions {
  throwOnGet?: boolean;
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

export function restoreStorage(): void {
  (globalThis as unknown as { localStorage: unknown }).localStorage = original;
}
