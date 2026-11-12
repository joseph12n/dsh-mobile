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

  it('exige la carpeta al crear una sesión', () => {
    const base = { v: PROTOCOL_VERSION, id: 'c', at, type: 'session.create' };
    expect(ClientMessage.safeParse({ ...base, workspaceId: 'w' }).success).toBe(true);
    expect(ClientMessage.safeParse(base).success).toBe(false);
    expect(ClientMessage.safeParse({ ...base, workspaceId: '' }).success).toBe(false);
  });

  it('archivar acepta el sobre con y sin stopActivity', () => {
    const base = { v: PROTOCOL_VERSION, id: 'a', at, type: 'workspace.archive', sessionId: 's' };
    expect(ClientMessage.safeParse(base).success).toBe(true);
    expect(ClientMessage.safeParse({ ...base, stopActivity: true }).success).toBe(true);
    expect(ClientMessage.safeParse({ ...base, stopActivity: 'sí' }).success).toBe(false);
  });

  it('hace ida y vuelta las confirmaciones de una acción', () => {
    const created = parseServerMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: 'c',
        at,
        type: 'session.created',
        sessionId: 'session-1',
      }),
    );
    const archived = parseServerMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: 'a',
        at,
        type: 'workspace.archived',
        sessionId: 'session-1',
      }),
    );

    expect(created?.type).toBe('session.created');
    expect(archived?.type).toBe('workspace.archived');
    // Una confirmación sin id no confirma nada: se descarta.
    expect(
      parseServerMessage(
        JSON.stringify({ v: PROTOCOL_VERSION, id: 'x', at, type: 'session.created' }),
      ),
    ).toBeUndefined();
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

  it('acepta un lote de preguntas con opciones', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'q',
      at,
      type: 'question.pending',
      question: {
        callId: 'call-1',
        sessionId: 's1',
        state: 'open',
        createdAt: at,
        items: [
          {
            id: 'q1',
            text: '¿Sigo?',
            options: [{ label: 'Sí' }, { label: 'No', description: 'mejor no' }],
            multiSelect: false,
            allowCustom: true,
          },
        ],
      },
    };
    expect(ServerMessage.safeParse(msg).success).toBe(true);
  });

  it('rechaza un lote sin preguntas', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'q',
      at,
      type: 'question.pending',
      question: { callId: 'c', sessionId: 's1', state: 'open', createdAt: at, items: 'nada' },
    };
    expect(ServerMessage.safeParse(msg).success).toBe(false);
  });
});

describe('respuestas a preguntas', () => {
  it('acepta una respuesta que omite una pregunta del lote', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'a',
      at,
      type: 'question.answer',
      callId: 'call-1',
      sessionId: 's1',
      answers: [{ id: 'q1', selected: [] }],
    };
    expect(ClientMessage.safeParse(msg).success).toBe(true);
  });

  it('acepta texto libre junto a la selección', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'a',
      at,
      type: 'question.answer',
      callId: 'call-1',
      sessionId: 's1',
      answers: [{ id: 'q1', selected: ['Sí'], custom: 'y además esto' }],
    };
    expect(ClientMessage.safeParse(msg).success).toBe(true);
  });

  it('exige al menos una respuesta: un lote vacío no es responder', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'a',
      at,
      type: 'question.answer',
      callId: 'call-1',
      sessionId: 's1',
      answers: [],
    };
    expect(ClientMessage.safeParse(msg).success).toBe(false);
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
