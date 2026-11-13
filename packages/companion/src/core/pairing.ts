import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const CODE_BYTES = 16;

export const DEFAULT_TTL_MS = 10 * 60 * 1000;

function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export interface IssuedCode {
  code: string;
  expiresAt: number;
}

export type RedeemResult = 'ok' | 'unknown' | 'expired' | 'consumed';

export interface PairingOptions {
  ttlMs?: number;
  now?: () => number;
  generate?: () => string;
}

interface PendingCode {
  expiresAt: number;
  consumed: boolean;
}

export class PairingService {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #generate: () => string;
  readonly #codes = new Map<string, PendingCode>();

  constructor(options: PairingOptions = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#generate = options.generate ?? (() => encodeBase32(randomBytes(CODE_BYTES)));
  }

  issue(): IssuedCode {
    this.#prune();
    const code = normalizeCode(this.#generate());
    const expiresAt = this.#now() + this.#ttlMs;
    this.#codes.set(code, { expiresAt, consumed: false });
    return { code, expiresAt };
  }

  redeem(raw: string): RedeemResult {
    const code = normalizeCode(raw);
    const entry = this.#codes.get(code);

    if (!entry) return 'unknown';
    if (entry.consumed) return 'consumed';
    if (entry.expiresAt <= this.#now()) {
      this.#codes.delete(code);
      return 'expired';
    }

    entry.consumed = true;
    return 'ok';
  }

  pending(): IssuedCode[] {
    this.#prune();
    const now = this.#now();
    return [...this.#codes.entries()]
      .filter(([, entry]) => !entry.consumed && entry.expiresAt > now)
      .map(([code, entry]) => ({ code, expiresAt: entry.expiresAt }));
  }

  #prune(): void {
    const horizon = this.#now() - 60 * 60 * 1000;
    for (const [code, entry] of this.#codes) {
      if (entry.expiresAt < horizon) this.#codes.delete(code);
    }
  }
}
