export * from './version.js';
export * from './errors.js';
export * from './domain.js';
export * from './envelope.js';
export * from './pairing.js';
export * from './messages.js';

import { ClientMessage, ServerMessage } from './messages.js';

/**
 * Genera un identificador de mensaje. Disponible en Node 24 y en cualquier
 * navegador con contexto seguro (que es el único sitio donde corre la PWA).
 */
export function newMessageId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Valida un mensaje recibido del cliente.
 *
 * Devuelve `undefined` si el JSON está roto o no cumple el esquema. El host
 * responde `bad-request` en ese caso; nunca lanza dentro del bucle de lectura.
 */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = ClientMessage.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Igual que `parseClientMessage`, para el lado del cliente. */
export function parseServerMessage(raw: string): ServerMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = ServerMessage.safeParse(value);
  return result.success ? result.data : undefined;
}
