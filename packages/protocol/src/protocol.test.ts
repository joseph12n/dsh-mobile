import { describe, expect, it } from 'vitest';
import {
  ClientMessage,
  PROTOCOL_VERSION,
  ServerMessage,
  TranscriptEvent,
  isSupportedVersion,
  newMessageId,
  parseClientMessage,
  parseServerMessage,
} from './index.js';

const at = 1_760_000_000_000;

describe('comandos', () => {
  const base = { v: PROTOCOL_VERSION, id: 'command-1', at: 1_760_000_000_000 };

  it('acepta listar y ejecutar comandos', () => {
    expect(
      ClientMessage.safeParse({ ...base, type: 'commands.list', sessionId: 'session-1' }).success,
    ).toBe(true);
    expect(
      ClientMessage.safeParse({
        ...base,
        type: 'command.run',
        sessionId: 'session-1',
        line: '/plan revisa el PR',
      }).success,
    ).toBe(true);
  });

  it('rechaza una línea sin nombre', () => {
    expect(
      ClientMessage.safeParse({ ...base, type: 'command.run', sessionId: 'session-1', line: '/' })
        .success,
    ).toBe(false);
    expect(
      ClientMessage.safeParse({ ...base, type: 'command.run', sessionId: 'session-1' }).success,
    ).toBe(false);
  });

  it('acepta las respuestas de lista y de ejecución', () => {
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'commands.ok',
        commands: [{ name: 'plan', description: 'Entrar en modo plan', hint: '<mensaje>' }],
      }).success,
    ).toBe(true);
    expect(ServerMessage.safeParse({ ...base, type: 'command.ok', kind: 'success' }).success).toBe(
      true,
    );
    expect(
      ServerMessage.safeParse({ ...base, type: 'command.ok', kind: 'error', text: 'no' }).success,
    ).toBe(true);
    expect(ServerMessage.safeParse({ ...base, type: 'command.ok', kind: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('actividad de la sesión', () => {
  const base = { v: PROTOCOL_VERSION, id: 'activity-1', at: 1_760_000_000_000 };

  it('acepta la petición y las actividades válidas', () => {
    expect(
      ClientMessage.safeParse({ ...base, type: 'session.activity', sessionId: 'session-1' })
        .success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'activity.ok',
        sessionId: 'session-1',
        activity: { subagents: [] },
      }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'activity.ok',
        sessionId: 'session-1',
        activity: {
          goal: { objective: 'Mejorar', phase: 'active', roundsStarted: 6, maxRounds: 256 },
          subagents: [{ id: 'child-1', activity: 'running', depth: 1 }],
          todos: { open: 1, total: 2, items: [{ content: 'Pintar', status: 'pending' }] },
        },
      }).success,
    ).toBe(true);
  });

  it('rechaza un estado de tarea desconocido', () => {
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'activity.ok',
        sessionId: 'session-1',
        activity: { subagents: [{ id: 'child-1', activity: 'running', depth: 1 }] },
      }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'activity.ok',
        sessionId: 'session-1',
        activity: { subagents: [{ id: 'child-1', activity: 'sleeping', depth: 1 }] },
      }).success,
    ).toBe(false);
  });
});

describe('dispositivos', () => {
  const base = { v: PROTOCOL_VERSION, id: 'devices-1', at: 1_760_000_000_000 };

  it('acepta listar y revocar', () => {
    expect(ClientMessage.safeParse({ ...base, type: 'devices.list' }).success).toBe(true);
    expect(
      ClientMessage.safeParse({ ...base, type: 'devices.revoke', deviceId: 'device-1' }).success,
    ).toBe(true);
    expect(ClientMessage.safeParse({ ...base, type: 'devices.revoke' }).success).toBe(false);
  });

  it('acepta la lista, la revocación y el cambio', () => {
    const device = { id: 'device-1', name: 'Pixel', createdAt: 1, lastSeenAt: 2 };
    expect(
      ServerMessage.safeParse({ ...base, type: 'devices.ok', devices: [device] }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({ ...base, type: 'devices.revoked', deviceId: 'device-1' }).success,
    ).toBe(true);
    expect(ServerMessage.safeParse({ ...base, type: 'devices.changed', devices: [] }).success).toBe(
      true,
    );
    expect(
      ServerMessage.safeParse({ ...base, type: 'devices.revoked', deviceId: '' }).success,
    ).toBe(false);
  });
});

describe('proveedores', () => {
  const base = { v: PROTOCOL_VERSION, id: 'provider-1', at: 1_760_000_000_000 };

  it('acepta listar, probar, conectar y desconectar', () => {
    expect(ClientMessage.safeParse({ ...base, type: 'providers.list' }).success).toBe(true);
    expect(
      ClientMessage.safeParse({
        ...base,
        type: 'provider.test',
        provider: 'opencode',
        apiKey: 'sk-x',
      }).success,
    ).toBe(true);
    expect(
      ClientMessage.safeParse({
        ...base,
        type: 'provider.connect',
        provider: 'opencode',
        apiKey: 'sk-x',
      }).success,
    ).toBe(true);
    expect(
      ClientMessage.safeParse({ ...base, type: 'provider.disconnect', provider: 'opencode' })
        .success,
    ).toBe(true);
  });

  it('rechaza una clave vacía o un nombre ausente', () => {
    expect(
      ClientMessage.safeParse({
        ...base,
        type: 'provider.connect',
        provider: 'opencode',
        apiKey: '',
      }).success,
    ).toBe(false);
    expect(
      ClientMessage.safeParse({ ...base, type: 'provider.disconnect', provider: '' }).success,
    ).toBe(false);
  });

  it('acepta las respuestas sin claves', () => {
    const view = {
      id: 'opencode',
      name: 'OpenCode',
      configured: true,
      credential: 'missing',
      action: 'add-key',
    };
    expect(
      ServerMessage.safeParse({ ...base, type: 'providers.ok', providers: [view] }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'provider.tested',
        provider: 'opencode',
        ok: true,
        code: 'ok',
      }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'provider.connected',
        provider: 'opencode',
        credential: 'set',
      }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'provider.disconnected',
        provider: 'opencode',
        credential: 'missing',
      }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        ...base,
        type: 'provider.tested',
        provider: 'opencode',
        ok: false,
        code: 'nope',
      }).success,
    ).toBe(false);
  });
});

describe('notificaciones push', () => {
  const base = { v: PROTOCOL_VERSION, id: 'push-1', at: 1_760_000_000_000 };
  const subscription = {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  };

  it('acepta la clave, la suscripción y la baja', () => {
    expect(ClientMessage.safeParse({ ...base, type: 'push.key' }).success).toBe(true);
    expect(ClientMessage.safeParse({ ...base, type: 'push.subscribe', subscription }).success).toBe(
      true,
    );
    expect(ClientMessage.safeParse({ ...base, type: 'push.unsubscribe' }).success).toBe(true);
  });

  it('rechaza una suscripción inválida', () => {
    expect(
      ClientMessage.safeParse({
        ...base,
        type: 'push.subscribe',
        subscription: { ...subscription, endpoint: 'not-a-url' },
      }).success,
    ).toBe(false);
    expect(
      ClientMessage.safeParse({
        ...base,
        type: 'push.subscribe',
        subscription: { ...subscription, keys: { p256dh: '', auth: 'auth' } },
      }).success,
    ).toBe(false);
  });

  it('acepta las respuestas', () => {
    expect(
      ServerMessage.safeParse({ ...base, type: 'push.key.ok', publicKey: 'BEl' }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({ ...base, type: 'push.subscribed', deviceId: 'dev-1' }).success,
    ).toBe(true);
    expect(ServerMessage.safeParse({ ...base, type: 'push.unsubscribed' }).success).toBe(true);
  });
});

describe('eventos de transcripción', () => {
  it('acepta el razonamiento opcional de una respuesta', () => {
    const event = { kind: 'message', role: 'assistant', text: 'hola', reasoning: 'pienso' };
    expect(TranscriptEvent.safeParse(event).success).toBe(true);
    expect(TranscriptEvent.safeParse({ ...event, reasoning: 3 }).success).toBe(false);
  });

  it('sigue aceptando un mensaje sin razonamiento', () => {
    expect(TranscriptEvent.safeParse({ kind: 'message', role: 'user', text: 'hola' }).success).toBe(
      true,
    );
  });
});

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

function sessionsOk(session: Record<string, unknown>): Record<string, unknown> {
  return {
    v: PROTOCOL_VERSION,
    id: 'l',
    at,
    type: 'sessions.ok',
    sessions: [session],
  };
}

describe('sesiones archivadas', () => {
  it('acepta pedir la lista con las archivadas', () => {
    const base = { v: PROTOCOL_VERSION, id: 'l', at, type: 'sessions.list' };
    expect(ClientMessage.safeParse(base).success).toBe(true);
    expect(ClientMessage.safeParse({ ...base, includeArchived: true }).success).toBe(true);
    expect(ClientMessage.safeParse({ ...base, includeArchived: 'sí' }).success).toBe(false);
  });

  it('marca la sesión archivada dentro de la lista', () => {
    const message = sessionsOk({
      id: 's1',
      title: 't',
      state: 'idle',
      updatedAt: at,
      seq: 1,
      pendingQuestions: 0,
      archived: true,
    });
    const parsed = ServerMessage.safeParse(message);
    expect(parsed.success).toBe(true);
  });

  it('acepta una lista de un host viejo, sin el campo archived', () => {
    const message = sessionsOk({
      id: 's1',
      title: 't',
      state: 'idle',
      updatedAt: at,
      seq: 1,
      pendingQuestions: 0,
    });
    expect(ServerMessage.safeParse(message).success).toBe(true);
  });

  it('rechaza una marca de archivada que no es booleana', () => {
    for (const archived of ['true', 1, null]) {
      const message = sessionsOk({
        id: 's1',
        title: 't',
        state: 'idle',
        updatedAt: at,
        seq: 1,
        pendingQuestions: 0,
        archived,
      });
      expect(ServerMessage.safeParse(message).success).toBe(false);
    }
  });

  it('descarta campos que no conoce en vez de rechazar el mensaje', () => {
    const message = { v: PROTOCOL_VERSION, id: 'l', at, type: 'sessions.list', algo: 'nuevo' };
    expect(ClientMessage.safeParse(message).success).toBe(true);
  });

  it('restaurar es su propio par de mensajes', () => {
    const request = {
      v: PROTOCOL_VERSION,
      id: 'u',
      at,
      type: 'workspace.unarchive',
      sessionId: 's1',
    };
    expect(ClientMessage.safeParse(request).success).toBe(true);

    const response = parseServerMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: 'u',
        at,
        type: 'workspace.unarchived',
        sessionId: 's1',
      }),
    );
    expect(response?.type).toBe('workspace.unarchived');
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
