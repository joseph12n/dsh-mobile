const TOKEN_KEY = 'dsh-mobile.device-token';
const ENDPOINT_KEY = 'dsh-mobile.endpoint';

function safeRead(key: string): string | undefined {
  try {
    return globalThis.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function safeWrite(key: string, value: string | undefined): void {
  try {
    if (value === undefined) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, value);
  } catch {}
}

export const storage = {
  token: (): string | undefined => safeRead(TOKEN_KEY),
  saveToken: (token: string | undefined): void => safeWrite(TOKEN_KEY, token),

  endpoint: (): string | undefined => safeRead(ENDPOINT_KEY),
  saveEndpoint: (endpoint: string | undefined): void => safeWrite(ENDPOINT_KEY, endpoint),
};
