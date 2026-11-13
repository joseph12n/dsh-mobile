export * from './version.js';
export * from './errors.js';
export * from './domain.js';
export * from './envelope.js';
export * from './pairing.js';
export * from './messages.js';

import { ClientMessage, ServerMessage } from './messages.js';

export function newMessageId(): string {
  return globalThis.crypto.randomUUID();
}

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
