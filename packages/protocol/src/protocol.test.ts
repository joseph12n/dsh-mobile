import { describe, expect, it } from 'vitest';
import {
  ClientMessage,
  PROTOCOL_VERSION,
  ServerMessage,
  isSupportedVersion,
  newMessageId,
  parseClientMessage,
  parseServerMessage,
} from './index.js';

const at = 1_760_000_000_000;

describe('negociación de versión', () => {
  it('acepta la versión que emite y rechaza el resto', () => {
    expect(isSupportedVersion(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedVersion(999)).toBe(false);
  });
});

describe('mensajes del cliente', () => {
  it('acepta hello con token', () => {
    const msg = { v: PROTOCOL_VERSION, id: 'a', at, type: 'hello', proto: 1, deviceToken: 'tok' };
    expect(ClientMessage.safeParse(msg).success).toBe(true);
  });

  it('acepta hello sin token, que es el camino de emparejamiento', () => {
    const msg = { v: PROTOCOL_VERSION, id: 'a', at, type: 'hello', proto: 1 };
    expect(ClientMessage.safeParse(msg).success).toBe(true);
  });

  it('rechaza una versión de sobre distinta', () => {
    const msg = { v: 2, id: 'a', at, type: 'ping' };
    expect(ClientMessage.safeParse(msg).success).toBe(false);
  });

  it('rechaza un tipo desconocido', () => {
    expect(
      ClientMessage.safeParse({ v: PROTOCOL_VERSION, id: 'a', at, type: 'drop.tables' }).success,
    ).toBe(false);
  });

  it('rechaza texto vacío en reply.send', () => {
    const msg = { v: PROTOCOL_VERSION, id: 'a', at, type: 'reply.send', sessionId: 's', text: '' };
    expect(ClientMessage.safeParse(msg).success).toBe(false);
  });

  it('exige el sobre completo', () => {
    expect(ClientMessage.safeParse({ v: PROTOCOL_VERSION, type: 'ping', at }).success).toBe(false);
  });
});

describe('mensajes del host', () => {
  it('acepta error con código estable', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'a',
      at,
      type: 'error',
      code: 'auth-invalid',
      message: 'no',
    };
    expect(ServerMessage.safeParse(msg).success).toBe(true);
  });

  it('rechaza un código de error inventado', () => {
    const msg = { v: PROTOCOL_VERSION, id: 'a', at, type: 'error', code: 'wat', message: 'no' };
    expect(ServerMessage.safeParse(msg).success).toBe(false);
  });

  it('acepta una pregunta pendiente con opciones', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'q',
      at,
      type: 'question.pending',
      question: {
        id: 'q1',
        sessionId: 's1',
        kind: 'select',
        text: '¿Sigo?',
        options: [{ id: 'yes', label: 'Sí' }],
        multiSelect: false,
        allowCustom: false,
        createdAt: at,
      },
    };
    expect(ServerMessage.safeParse(msg).success).toBe(true);
  });
});

describe('lectura de marcos', () => {
  it('devuelve undefined ante JSON roto y no lanza', () => {
    expect(parseClientMessage('{no json')).toBeUndefined();
  });

  it('devuelve undefined ante un esquema inválido', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'ping' }))).toBeUndefined();
  });

  it('hace ida y vuelta un mensaje válido', () => {
    const original = { v: PROTOCOL_VERSION, id: newMessageId(), at, type: 'sessions.list' };
    const parsed = parseClientMessage(JSON.stringify(original));
    expect(parsed).toEqual(original);
  });

  it('parseServerMessage ignora tipos de cliente', () => {
    const msg = { v: PROTOCOL_VERSION, id: 'a', at, type: 'sessions.list' };
    expect(parseServerMessage(JSON.stringify(msg))).toBeUndefined();
  });
});
