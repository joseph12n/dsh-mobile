import { ConnectionError, PairingError } from './connection.js';

export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

export function retryDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index] ?? 30_000;
}

export type FailureKind = 'auth' | 'pairing' | 'fatal' | 'transient';

const FATAL_CODES = new Set(['proto-unsupported', 'bad-request', 'denied', 'not-found']);

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof PairingError) return 'pairing';

  if (error instanceof ConnectionError && error.code) {
    if (error.code === 'auth-required' || error.code === 'auth-invalid') return 'auth';
    if (FATAL_CODES.has(error.code)) return 'fatal';
  }

  return 'transient';
}
