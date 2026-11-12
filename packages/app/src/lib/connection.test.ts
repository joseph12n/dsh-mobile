import { describe, expect, it } from 'vitest';
import { ConnectionError, isAuthFailure } from './connection.js';

/**
 * Distinguir «no hay red» de «este token ya no vale» es lo que evita que un bache
 * de cobertura cueste volver a emparejar.
 */

describe('fallos de conexión', () => {
  it('un token rechazado es fallo de autenticación', () => {
    expect(isAuthFailure(new ConnectionError('no', 'auth-required'))).toBe(true);
    expect(isAuthFailure(new ConnectionError('no', 'auth-invalid'))).toBe(true);
  });

  it('un fallo de red no lo es', () => {
    expect(isAuthFailure(new Error('No pude abrir el WebSocket.'))).toBe(false);
    expect(isAuthFailure(new ConnectionError('timeout'))).toBe(false);
  });

  it('otros códigos del protocolo no cuentan como token inválido', () => {
    for (const code of ['not-found', 'denied', 'rate-limited', 'bad-request']) {
      expect(isAuthFailure(new ConnectionError('x', code))).toBe(false);
    }
  });

  it('un valor que no es error no rompe', () => {
    expect(isAuthFailure(undefined)).toBe(false);
    expect(isAuthFailure('auth-required')).toBe(false);
  });
});
