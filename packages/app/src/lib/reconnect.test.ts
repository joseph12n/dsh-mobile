import { describe, expect, it } from 'vitest';
import { ConnectionError, PairingError } from './connection.js';
import { RETRY_DELAYS_MS, classifyFailure, retryDelay } from './reconnect.js';

describe('retry backoff', () => {
  it('grows and then caps', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 20].map(retryDelay);
    expect(delays.slice(0, 6)).toEqual([...RETRY_DELAYS_MS]);
    expect(delays[6]).toBe(30_000);
    expect(delays[7]).toBe(30_000);
  });

  it('a negative attempt does not crash', () => {
    expect(retryDelay(-3)).toBe(1_000);
  });
});

describe('failure classification', () => {
  it('an unknown token is the only reason to drop the pairing', () => {
    expect(classifyFailure(new ConnectionError('no', 'auth-required'))).toBe('auth');
    expect(classifyFailure(new ConnectionError('no', 'auth-invalid'))).toBe('auth');
  });

  it('a network failure is transient, never auth', () => {
    expect(classifyFailure(new Error('No pude abrir el WebSocket.'))).toBe('transient');
    expect(classifyFailure(new Error('Timeout conectando.'))).toBe('transient');
  });

  it('protocol errors that will not fix themselves are fatal', () => {
    for (const code of ['proto-unsupported', 'bad-request', 'denied', 'not-found']) {
      expect(classifyFailure(new ConnectionError('no', code))).toBe('fatal');
    }
  });

  it('rate limiting is worth retrying', () => {
    expect(classifyFailure(new ConnectionError('espera', 'rate-limited'))).toBe('transient');
  });

  it('a bad pairing code goes back to the form, it does not retry', () => {
    expect(classifyFailure(new PairingError('Código desconocido'))).toBe('pairing');
  });

  it('a pairing error beats an inner connection code', () => {
    expect(classifyFailure(new PairingError('no', 'not-found'))).toBe('pairing');
  });

  it('a non-error value is treated as transient', () => {
    expect(classifyFailure(undefined)).toBe('transient');
    expect(classifyFailure('boom')).toBe('transient');
  });
});
