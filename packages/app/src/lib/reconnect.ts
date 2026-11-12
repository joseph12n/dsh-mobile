import { ConnectionError, PairingError } from './connection.js';

/**
 * Política de reconexión.
 *
 * El problema que resuelve: la PWA se desconecta sola todo el rato (el móvil
 * cambia de red, apaga la pantalla, el tailnet parpadea). Antes, cualquier fallo
 * dejaba una pantalla de error cuyo único botón **borraba el emparejamiento**.
 *
 * Vive aparte de la interfaz para poder probarse: la diferencia entre «reintenta»
 * y «esto no se arregla reintentando» es justo lo que estaba mal.
 */

/** Espera entre reintentos, en milisegundos. La última se repite. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

/** Espera para el intento `attempt`, empezando en 0. */
export function retryDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index] ?? 30_000;
}

/**
 * Qué hacer con un fallo.
 *
 * - `auth`: el host ya no reconoce el token. Reintentar no arregla nada; hay que
 *   emparejar. Es el **único** caso en el que se borra el token.
 * - `pairing`: falló el canje del código. Se muestra el motivo y no se reintenta.
 * - `fatal`: error del protocolo que no se resuelve solo (proto no soportado, petición
 *   inválida, permiso denegado). Pantalla de error con reintento manual.
 * - `transient`: red. Se reintenta con espera creciente.
 */
export type FailureKind = 'auth' | 'pairing' | 'fatal' | 'transient';

/** Códigos que no se arreglan reintentando. */
const FATAL_CODES = new Set(['proto-unsupported', 'bad-request', 'denied', 'not-found']);

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof PairingError) return 'pairing';

  if (error instanceof ConnectionError && error.code) {
    if (error.code === 'auth-required' || error.code === 'auth-invalid') return 'auth';
    if (FATAL_CODES.has(error.code)) return 'fatal';
  }

  // Un `rate-limited` sí se puede reintentar; cae en `transient`.
  return 'transient';
}
