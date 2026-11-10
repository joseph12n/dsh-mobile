import { randomBytes } from 'node:crypto';

/**
 * Códigos de emparejamiento de un solo uso.
 *
 * Dominio puro: no toca disco ni red, y el reloj y la entropía se inyectan, así
 * que la caducidad y el consumo se pueden probar sin esperar diez minutos.
 */

/** Alfabeto Crockford base32: sin I, L, O ni U, para que nadie confunda 1/l/0. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 bytes = 128 bits de entropía. */
export const CODE_BYTES = 16;

/** Una sola vez, diez minutos. */
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Codifica bytes en base32 Crockford (5 bits por carácter). */
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

/** Normaliza lo que teclea o pega un humano: mayúsculas, sin separadores. */
export function normalizeCode(raw: string): string {
  return (
    raw
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '')
      // Crockford: I y L valen 1; O vale 0.
      .replace(/[IL]/g, '1')
      .replace(/O/g, '0')
  );
}

export interface IssuedCode {
  code: string;
  expiresAt: number;
}

export type RedeemResult = 'ok' | 'unknown' | 'expired' | 'consumed';

export interface PairingOptions {
  ttlMs?: number;
  now?: () => number;
  /** Inyectable para pruebas; por defecto 16 bytes aleatorios. */
  generate?: () => string;
}

interface PendingCode {
  expiresAt: number;
  /** Se marca al canjearse para distinguir "no existe" de "ya usado". */
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

  /** Emite un código nuevo. No invalida los anteriores: se pueden tener varios. */
  issue(): IssuedCode {
    this.#prune();
    // Se guarda ya normalizado: así lo que se emite es exactamente lo que se
    // podrá canjear, aunque algún día el generador use letras ambiguas.
    const code = normalizeCode(this.#generate());
    const expiresAt = this.#now() + this.#ttlMs;
    this.#codes.set(code, { expiresAt, consumed: false });
    return { code, expiresAt };
  }

  /**
   * Canjea un código. Es de un solo uso: el primero gana.
   *
   * `consumed` se conserva un tiempo para poder responder "ya usado" en vez de
   * "no existe", que es un mensaje mucho más útil para quien está emparejando.
   */
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

  /** Códigos vigentes y sin canjear. Sirve para mostrarlos en la UI del host. */
  pending(): IssuedCode[] {
    this.#prune();
    const now = this.#now();
    return [...this.#codes.entries()]
      .filter(([, entry]) => !entry.consumed && entry.expiresAt > now)
      .map(([code, entry]) => ({ code, expiresAt: entry.expiresAt }));
  }

  /**
   * Descarta los códigos que llevan más de una hora vencidos.
   *
   * Se conservan un rato después de vencer para poder distinguir "caducado" y
   * "ya usado" de "no existe": es el mensaje que de verdad ayuda a quien está
   * intentando emparejar.
   */
  #prune(): void {
    const horizon = this.#now() - 60 * 60 * 1000;
    for (const [code, entry] of this.#codes) {
      if (entry.expiresAt < horizon) this.#codes.delete(code);
    }
  }
}
