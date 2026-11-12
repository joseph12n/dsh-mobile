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

  it('acepta un hello.ok con una capacidad que este cliente no conoce', () => {
    // El enum es del cliente, no del cable: rechazar el frame entero por una capacidad
    // nueva dejaría al cliente sin conexión y `connect()` moriría por timeout.
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'h',
      at,
      type: 'hello.ok',
      host: {
        id: 'h',
        name: 'n',
        version: '1',
        platform: 'p',
        capabilities: ['session.create', 'algo-del-futuro'],
      },
    };
    const parsed = ServerMessage.safeParse(msg);
    expect(parsed.success).toBe(true);
  });

  it('rechaza una capacidad que no es texto', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'h',
      at,
      type: 'hello.ok',
      host: { id: 'h', name: 'n', version: '1', platform: 'p', capabilities: [42] },
    };
    expect(ServerMessage.safeParse(msg).success).toBe(false);
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

describe('modelos', () => {
  it('acepta un catálogo con grupos, esfuerzos y fallos', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'm',
      at,
      type: 'models.ok',
      catalog: {
        default: { provider: 'deepseek', model: 'chat' },
        groups: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            models: [
              {
                id: 'chat',
                name: 'DeepSeek Chat',
                reasoningEfforts: [{ id: 'high', name: 'High' }],
                defaultReasoningEffort: 'high',
              },
            ],
          },
        ],
        failures: [{ id: 'other', name: 'Other', message: 'no credentials' }],
      },
    };
    expect(ServerMessage.safeParse(msg).success).toBe(true);
  });

  it('acepta un catálogo vacío: un host sin modelos sigue siendo válido', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 'm',
      at,
      type: 'models.ok',
      catalog: { groups: [], failures: [] },
    };
    expect(ServerMessage.safeParse(msg).success).toBe(true);
  });

  it('exige un modelo concreto al elegir', () => {
    const base = { v: PROTOCOL_VERSION, id: 's', at, type: 'model.select', sessionId: 's1' };
    expect(ClientMessage.safeParse({ ...base, provider: 'p', model: 'm' }).success).toBe(true);
    expect(ClientMessage.safeParse({ ...base, provider: 'p' }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...base, model: '' }).success).toBe(false);
  });

  it('rechaza un esfuerzo vacío, que no es "sin esfuerzo" sino un error', () => {
    const msg = {
      v: PROTOCOL_VERSION,
      id: 's',
      at,
      type: 'model.select',
      sessionId: 's1',
      provider: 'p',
      model: 'm',
      reasoningEffort: '',
    };
    expect(ClientMessage.safeParse(msg).success).toBe(false);
  });

  it('el resumen de sesión puede traer el modelo, o no traerlo', () => {
    const base = {
      id: 's1',
      title: 't',
      state: 'idle',
      updatedAt: at,
      seq: 1,
      pendingQuestions: 0,
    };
    expect(ServerMessage.safeParse(sessionsOk(base)).success).toBe(true);
    expect(
      ServerMessage.safeParse(sessionsOk({ ...base, model: { provider: 'p', model: 'm' } }))
        .success,
    ).toBe(true);
  });
});

/** Un `sessions.ok` con la sesión dada, para no repetir el sobre. */
function sessionsOk(session: Record<string, unknown>): Record<string, unknown> {
  return {
    v: PROTOCOL_VERSION,
    id: 'l',
    at,
    type: 'sessions.ok',
    sessions: [session],
  };
}

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
