import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, WEBSOCKET_PATH, parseServerMessage } from '@dsh-mobile/protocol';
import { DeviceRegistry, type DevicePersistence, type StoredDevice } from './core/devices.js';
import { PairingService } from './core/pairing.js';
import { startCompanionServer, type RunningServer } from './server.js';

/**
 * El listener con sus piezas reales: canje de códigos, tokens de dispositivo y
 * autenticación. Un cliente WebSocket de verdad contra un servidor de verdad, en
 * un puerto efímero.
 */

class MemoryPersistence implements DevicePersistence {
  devices: StoredDevice[] = [];
  load(): StoredDevice[] {
    return this.devices;
  }
  save(devices: StoredDevice[]): void {
    this.devices = devices;
  }
}

let running: RunningServer;
let base: string;
let pairing: PairingService;
let code = '';

beforeAll(async () => {
  pairing = new PairingService();
  const devices = new DeviceRegistry({ persistence: new MemoryPersistence() });

  running = await startCompanionServer({
    pairing,
    devices,
    port: 0,
    publicUrl: 'https://maquina.tailnet.ts.net',
    capabilities: ['reply.send'],
    report: () => ({
      timestamp: 'test',
      serviceNames: [],
      serviceDetails: [],
      services: {},
      sessionCount: 0,
      sessions: [],
      injectionCandidates: {},
    }),
  });

  base = `127.0.0.1:${running.port}`;
  code = pairing.issue().code;
});

afterAll(async () => {
  await running.close();
});

interface TestClient {
  send(payload: unknown): void;
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
}

async function openClient(port?: number): Promise<TestClient> {
  const target = port ?? running.port;
  const socket = new WebSocket(`ws://127.0.0.1:${target}${WEBSOCKET_PATH}`);
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(value: Record<string, unknown>) => void> = [];

  socket.on('message', (data: Buffer) => {
    const parsed = parseServerMessage(data.toString('utf8'));
    if (!parsed) throw new Error(`respuesta fuera de contrato: ${data.toString('utf8')}`);
    const waiter = waiters.shift();
    if (waiter) waiter(parsed as Record<string, unknown>);
    else queue.push(parsed as Record<string, unknown>);
  });

  await once(socket, 'open');

  return {
    send(payload) {
      socket.send(JSON.stringify(payload));
    },
    next(timeoutMs = 3000) {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout esperando respuesta')), timeoutMs);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    },
    close() {
      socket.close();
    },
  };
}

function hello(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: PROTOCOL_VERSION, id: 'hello', at: Date.now(), type: 'hello', proto: 1, ...extra };
}

/**
 * Petición GET con una cabecera `Host` concreta.
 *
 * `fetch` no deja fijarla porque es una cabecera reservada, así que aquí se usa
 * `node:http` directamente. Sirve para simular el proxy del tailnet.
 */
function getWithHost(
  port: number,
  path: string,
  host: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { ...extraHeaders, host } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve(body));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

describe('superficie HTTP', () => {
  it('responde /health con el protocolo y los dispositivos', async () => {
    const response = await fetch(`http://${base}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; proto: number; devices: number };
    expect(body.ok).toBe(true);
    expect(body.proto).toBe(PROTOCOL_VERSION);
    expect(body.devices).toBe(0);
  });

  it('sirve la PWA cuando hay raíz web', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'dsh-mobile-serve-'));
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>DSH Mobile</title>');

    const withWeb = await startCompanionServer({
      pairing: new PairingService(),
      devices: new DeviceRegistry({ persistence: new MemoryPersistence() }),
      port: 0,
      webRoot,
    });

    try {
      const origin = `http://127.0.0.1:${withWeb.port}`;

      const index = await fetch(`${origin}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('DSH Mobile');

      // La SPA cae al índice en cualquier ruta sin extensión.
      const deep = await fetch(`${origin}/sesiones/abc`);
      expect(deep.status).toBe(200);

      // La API sigue mandando sobre los archivos.
      expect((await fetch(`${origin}/health`)).status).toBe(200);
    } finally {
      await withWeb.close();
    }
  });

  it('sirve el QR de emparejamiento como página', async () => {
    const html = await (await fetch(`http://${base}/pair`)).text();
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('#/pair');
    expect(html).toContain('https://maquina.tailnet.ts.net');
  });

  it('el QR toma la dirección por la que se entró, y avisa si es loopback', async () => {
    // Sin URL pública el origen sale del Host; este servidor no tiene ninguna fijada.
    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: new DeviceRegistry({ persistence: new MemoryPersistence() }),
      port: 0,
    });

    try {
      const localHtml = await (await fetch(`http://127.0.0.1:${server.port}/pair`)).text();
      expect(localHtml).toContain('http://127.0.0.1:');
      expect(localHtml).toContain('will not work from a phone');

      // `fetch` prohíbe fijar Host (es cabecera reservada), así que se usa http
      // crudo: es la única forma de simular el proxy del tailnet.
      const remoteHtml = await getWithHost(server.port, '/pair', 'maquina.tailnet.ts.net');
      expect(remoteHtml).toContain('https://maquina.tailnet.ts.net');
      expect(remoteHtml).not.toContain('will not work from a phone');

      const healthRaw = await getWithHost(server.port, '/health', '127.0.0.1');
      const health = JSON.parse(healthRaw) as {
        origin?: string;
        warning?: string;
        warningSeverity?: string;
      };
      expect(health.origin).toContain('127.0.0.1');
      expect(health.warning).toContain('phone');
      expect(health.warningSeverity).toBe('blocking');
    } finally {
      await server.close();
    }
  });

  it('un Host inválido no tumba /pair ni deja la petición sin respuesta', async () => {
    // Hallazgo de revisión: el `Host` lo controla el cliente y llegaba hasta
    // `new URL()`, que lanzaba. Sin respuesta, y sin manejador global, caía el host.
    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: new DeviceRegistry({ persistence: new MemoryPersistence() }),
      port: 0,
    });

    try {
      // Solo valores que el cliente HTTP de Node acepte enviar: un carácter NUL
      // lo rechaza él mismo antes de salir, y ese caso ya lo cubre la prueba
      // unitaria de `publicOriginFor`.
      for (const host of ['a b', 'ejemplo:99999', '[::1', 'http://']) {
        const html = await getWithHost(server.port, '/pair', host);
        expect(html, host).toContain('data:image/png;base64,');
        // Cae al listener y lo dice, en vez de reventar.
        expect(html, host).toContain('http://127.0.0.1:');
      }

      // El servidor sigue vivo después de los intentos.
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('avisa sin bloquear cuando el proxy declara http', async () => {
    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: new DeviceRegistry({ persistence: new MemoryPersistence() }),
      port: 0,
    });

    try {
      const html = await getWithHost(server.port, '/pair', 'maquina.tailnet.ts.net', {
        'x-forwarded-proto': 'http',
      });
      expect(html).toContain('http://maquina.tailnet.ts.net');
      expect(html).toContain('will not be able to install it');
      expect(html).not.toContain('will not work from a phone');
    } finally {
      await server.close();
    }
  });

  it('devuelve 404 en una ruta desconocida', async () => {
    expect((await fetch(`http://${base}/no-existe`)).status).toBe(404);
  });
});

describe('contrato sobre WebSocket', () => {
  it('responde ping con pong conservando el id', async () => {
    const client = await openClient();
    client.send({ v: PROTOCOL_VERSION, id: 'p1', at: Date.now(), type: 'ping' });
    const response = await client.next();
    expect(response['type']).toBe('pong');
    expect(response['id']).toBe('p1');
    client.close();
  });

  it('acepta hello sin token y no entrega dispositivo', async () => {
    const client = await openClient();
    client.send(hello());
    const response = await client.next();
    expect(response['type']).toBe('hello.ok');
    expect(response['device']).toBeUndefined();
    client.close();
  });

  it('rechaza una versión de protocolo desconocida', async () => {
    const client = await openClient();
    client.send({ ...hello(), proto: 999 });
    const response = await client.next();
    expect(response['type']).toBe('error');
    expect(response['code']).toBe('proto-unsupported');
    client.close();
  });

  it('rechaza un marco fuera de contrato', async () => {
    const client = await openClient();
    client.send({ hola: 'mundo' });
    const response = await client.next();
    expect(response['code']).toBe('bad-request');
    client.close();
  });

  it('exige hello antes de emparejar', async () => {
    const client = await openClient();
    client.send({
      v: PROTOCOL_VERSION,
      id: 'r1',
      at: Date.now(),
      type: 'pair.redeem',
      code,
      deviceName: 'Pixel',
      platform: 'android',
    });
    const response = await client.next();
    expect(response['code']).toBe('auth-required');
    client.close();
  });

  it('exige emparejamiento para los comandos de sesión', async () => {
    const client = await openClient();
    client.send(hello());
    await client.next();
    client.send({ v: PROTOCOL_VERSION, id: 's1', at: Date.now(), type: 'sessions.list' });
    const response = await client.next();
    expect(response['code']).toBe('auth-required');
    client.close();
  });

  it('rechaza un token inválido', async () => {
    const client = await openClient();
    client.send(hello({ deviceToken: 'inventado' }));
    const response = await client.next();
    expect(response['code']).toBe('auth-invalid');
    client.close();
  });
});

describe('listado de sesiones sobre el WebSocket', () => {
  it('entrega las sesiones a un dispositivo emparejado', async () => {
    const persistence = new MemoryPersistence();
    const registry = new DeviceRegistry({ persistence });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      listSessions: () =>
        Promise.resolve([
          {
            id: 'session-uno',
            title: 'Primera',
            updatedAt: 1_700_000_000_000,
            seq: 12,
            agentAvailable: true,
            running: false,
            pendingQuestions: 0,
          },
        ]),
    });

    try {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}${WEBSOCKET_PATH}`);
      const messages: Record<string, unknown>[] = [];
      socket.on('message', (data: Buffer) => {
        const parsed = parseServerMessage(data.toString('utf8'));
        if (parsed) messages.push(parsed as Record<string, unknown>);
      });
      await once(socket, 'open');

      socket.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          id: 'h',
          at: Date.now(),
          type: 'hello',
          proto: 1,
          deviceToken: token,
        }),
      );
      socket.send(
        JSON.stringify({ v: PROTOCOL_VERSION, id: 'l', at: Date.now(), type: 'sessions.list' }),
      );

      await new Promise((resolve) => setTimeout(resolve, 300));
      socket.close();

      const listing = messages.find((message) => message['type'] === 'sessions.ok');
      expect(listing).toBeDefined();
      const sessions = listing?.['sessions'] as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ id: 'session-uno', title: 'Primera', state: 'idle' });
    } finally {
      await server.close();
    }
  });

  it('devuelve una lista vacía si el host no tiene fuente de sesiones', async () => {
    const persistence = new MemoryPersistence();
    const registry = new DeviceRegistry({ persistence });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
    });

    try {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}${WEBSOCKET_PATH}`);
      const messages: Record<string, unknown>[] = [];
      socket.on('message', (data: Buffer) => {
        const parsed = parseServerMessage(data.toString('utf8'));
        if (parsed) messages.push(parsed as Record<string, unknown>);
      });
      await once(socket, 'open');
      socket.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          id: 'h',
          at: Date.now(),
          type: 'hello',
          proto: 1,
          deviceToken: token,
        }),
      );
      socket.send(
        JSON.stringify({ v: PROTOCOL_VERSION, id: 'l', at: Date.now(), type: 'sessions.list' }),
      );

      await new Promise((resolve) => setTimeout(resolve, 300));
      socket.close();

      const listing = messages.find((message) => message['type'] === 'sessions.ok');
      expect(listing?.['sessions']).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe('preguntas sobre el WebSocket', () => {
  const batch = {
    callId: 'call-1',
    sessionId: 'session-uno',
    state: 'open' as const,
    createdAt: 0,
    items: [
      {
        id: 'q1',
        text: '¿Sigo?',
        options: [{ label: 'Sí' }, { label: 'No' }],
        multiSelect: false,
        allowCustom: true,
      },
    ],
  };

  async function withServer(
    deps: { answer?: (input: { callId: string; sessionId: string; answers: unknown[] }) => never },
    run: (client: TestClient) => Promise<void>,
  ): Promise<void> {
    const registry = new DeviceRegistry({ persistence: new MemoryPersistence() });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      listSessions: () =>
        Promise.resolve([
          {
            id: 'session-uno',
            title: 'Con pregunta',
            updatedAt: 1,
            seq: 3,
            agentAvailable: true,
            running: false,
            pendingQuestions: 1,
          },
        ]),
      listQuestions: () => [batch],
      ...(deps.answer
        ? {
            answerQuestion: deps.answer as unknown as (input: {
              callId: string;
              sessionId: string;
              answers: Array<{ id: string; selected: string[] }>;
            }) => {
              ok: boolean;
              code?: 'not-found' | 'bad-request' | 'internal';
              message?: string;
            },
          }
        : {}),
    });

    try {
      const client = await openClient(server.port);
      client.send(hello({ deviceToken: token }));
      // Sin esperar al hello.ok, la primera respuesta que llegaría sería esa.
      const ready = await client.next();
      expect(ready['type']).toBe('hello.ok');
      await run(client);
      client.close();
    } finally {
      await server.close();
    }
  }

  it('empuja los lotes pendientes justo detrás de la lista', async () => {
    await withServer({}, async (client) => {
      client.send({ v: PROTOCOL_VERSION, id: 'l', at: Date.now(), type: 'sessions.list' });
      const listing = await client.next();
      expect(listing['type']).toBe('sessions.ok');

      const pending = await client.next();
      expect(pending['type']).toBe('question.pending');
      const question = pending['question'] as { callId: string; items: unknown[] };
      expect(question.callId).toBe('call-1');
      expect(question.items).toHaveLength(1);
    });
  });

  it('confirma la respuesta con answer.ok', async () => {
    await withServer({ answer: () => ({ ok: true }) as never }, async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'a',
        at: Date.now(),
        type: 'question.answer',
        callId: 'call-1',
        sessionId: 'session-uno',
        answers: [{ id: 'q1', selected: ['Sí'] }],
      });
      const response = await client.next();
      expect(response['type']).toBe('answer.ok');
      expect(response['callId']).toBe('call-1');
    });
  });

  it('traduce el fallo del host a un error de contrato', async () => {
    await withServer(
      {
        answer: () =>
          ({
            ok: false,
            code: 'not-found',
            message: 'La sesión no está cargada en el host.',
          }) as never,
      },
      async (client) => {
        client.send({
          v: PROTOCOL_VERSION,
          id: 'a',
          at: Date.now(),
          type: 'question.answer',
          callId: 'call-1',
          sessionId: 'session-uno',
          answers: [{ id: 'q1', selected: ['Sí'] }],
        });
        const response = await client.next();
        expect(response['type']).toBe('error');
        expect(response['code']).toBe('not-found');
      },
    );
  });
});

describe('transcripción sobre el WebSocket', () => {
  async function withTranscript(
    deps: {
      history?: (
        sessionId: string,
        options: { before?: number; limit?: number },
      ) => Promise<{
        entries: Array<{ seq: number; at: number; event: { kind: 'state'; state: 'idle' } }>;
        hasMore: boolean;
      }>;
      subscribe?: (
        sessionId: string,
        options: { since?: number; onEvent: (e: never) => void; onEnd?: () => void },
      ) => { stop(): void };
      cancel?: (sessionId: string) => boolean;
    },
    run: (client: TestClient) => Promise<void>,
  ): Promise<void> {
    const registry = new DeviceRegistry({ persistence: new MemoryPersistence() });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      ...(deps.history ? { readHistory: deps.history } : {}),
      ...(deps.subscribe
        ? {
            subscribeSession: deps.subscribe as unknown as NonNullable<
              Parameters<typeof startCompanionServer>[0]['subscribeSession']
            >,
          }
        : {}),
      ...(deps.cancel ? { cancelRun: deps.cancel } : {}),
    });

    try {
      const client = await openClient(server.port);
      client.send(hello({ deviceToken: token }));
      await client.next();
      await run(client);
      client.close();
    } finally {
      await server.close();
    }
  }

  const entry = {
    seq: 7,
    at: 1_700_000_000_000,
    event: { kind: 'state' as const, state: 'idle' as const },
  };

  it('devuelve una página de historial', async () => {
    await withTranscript(
      { history: async () => ({ entries: [entry], hasMore: true }) },
      async (client) => {
        client.send({
          v: PROTOCOL_VERSION,
          id: 'h',
          at: Date.now(),
          type: 'session.history',
          sessionId: 'session-uno',
          limit: 10,
        });
        const response = await client.next();
        expect(response['type']).toBe('history.ok');
        expect((response['entries'] as unknown[]).length).toBe(1);
        expect(response['hasMore']).toBe(true);
      },
    );
  });

  it('devuelve historial vacío si el host no puede leerlo', async () => {
    await withTranscript({}, async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'h',
        at: Date.now(),
        type: 'session.history',
        sessionId: 'session-uno',
      });
      const response = await client.next();
      expect(response['type']).toBe('history.ok');
      expect(response['entries']).toEqual([]);
    });
  });

  it('confirma la suscripción y empuja los eventos', async () => {
    await withTranscript(
      {
        subscribe: (_sessionId, options) => {
          // Emite un evento tras confirmar, como haría el host real.
          setTimeout(() => options.onEvent(entry as never), 20);
          return { stop: () => undefined };
        },
      },
      async (client) => {
        client.send({
          v: PROTOCOL_VERSION,
          id: 'sub',
          at: Date.now(),
          type: 'session.subscribe',
          sessionId: 'session-uno',
          since: 3,
        });

        const ack = await client.next();
        expect(ack['type']).toBe('session.ok');
        expect(ack['seq']).toBe(3);

        const event = await client.next();
        expect(event['type']).toBe('session.event');
        expect(event['seq']).toBe(7);
      },
    );
  });

  it('cancela una ejecución en curso', async () => {
    await withTranscript({ cancel: () => true }, async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'c',
        at: Date.now(),
        type: 'run.cancel',
        sessionId: 'session-uno',
      });
      const response = await client.next();
      expect(response['type']).toBe('run.ok');
      expect(response['state']).toBe('idle');
    });
  });

  it('explica cuando no hay nada que cancelar', async () => {
    await withTranscript({ cancel: () => false }, async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'c',
        at: Date.now(),
        type: 'run.cancel',
        sessionId: 'session-uno',
      });
      const response = await client.next();
      expect(response['type']).toBe('error');
      expect(response['code']).toBe('not-found');
    });
  });

  it('confirma el texto enviado a la sesión', async () => {
    const registry = new DeviceRegistry({ persistence: new MemoryPersistence() });
    const { token } = registry.enroll('Pixel', 'android');
    const sent: Array<{ sessionId: string; text: string }> = [];

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      sendReply: (sessionId, text) => {
        sent.push({ sessionId, text });
        return Promise.resolve({ ok: true });
      },
    });

    try {
      const client = await openClient(server.port);
      client.send(hello({ deviceToken: token }));
      await client.next();
      client.send({
        v: PROTOCOL_VERSION,
        id: 'r',
        at: Date.now(),
        type: 'reply.send',
        sessionId: 'session-uno',
        text: 'hola desde el móvil',
      });

      const response = await client.next();
      expect(response['type']).toBe('reply.ok');
      expect(response['sessionId']).toBe('session-uno');
      expect(sent).toEqual([{ sessionId: 'session-uno', text: 'hola desde el móvil' }]);
      client.close();
    } finally {
      await server.close();
    }
  });

  it('traduce el fallo al escribir en un error de contrato', async () => {
    const registry = new DeviceRegistry({ persistence: new MemoryPersistence() });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      sendReply: () =>
        Promise.resolve({ ok: false, code: 'bad-request' as const, message: 'vacío' }),
    });

    try {
      const client = await openClient(server.port);
      client.send(hello({ deviceToken: token }));
      await client.next();
      client.send({
        v: PROTOCOL_VERSION,
        id: 'r',
        at: Date.now(),
        type: 'reply.send',
        sessionId: 'session-uno',
        text: 'algo',
      });
      const response = await client.next();
      expect(response['type']).toBe('error');
      expect(response['code']).toBe('bad-request');
      client.close();
    } finally {
      await server.close();
    }
  });
});

describe('emparejamiento de punta a punta', () => {
  it('canjea el código, entrega el token y autentica con él', async () => {
    const client = await openClient();
    client.send(hello());
    await client.next();

    client.send({
      v: PROTOCOL_VERSION,
      id: 'redeem',
      at: Date.now(),
      type: 'pair.redeem',
      code,
      deviceName: 'Pixel de prueba',
      platform: 'android',
    });

    const paired = await client.next();
    expect(paired['type']).toBe('pair.ok');
    const token = paired['deviceToken'] as string;
    expect(token).toBeTruthy();
    expect((paired['device'] as { name: string }).name).toBe('Pixel de prueba');
    client.close();

    // El token sirve para una conexión nueva: así se comporta un teléfono real.
    const second = await openClient();
    second.send(hello({ deviceToken: token }));
    const response = await second.next();
    expect(response['type']).toBe('hello.ok');
    expect((response['device'] as { name: string }).name).toBe('Pixel de prueba');
    second.close();
  });

  it('no permite reutilizar el código', async () => {
    const client = await openClient();
    client.send(hello());
    await client.next();
    client.send({
      v: PROTOCOL_VERSION,
      id: 'again',
      at: Date.now(),
      type: 'pair.redeem',
      code,
      deviceName: 'Otro',
      platform: 'ios',
    });
    const response = await client.next();
    expect(response['code']).toBe('auth-invalid');
    client.close();
  });

  it('rechaza un código inventado', async () => {
    const client = await openClient();
    client.send(hello());
    await client.next();
    client.send({
      v: PROTOCOL_VERSION,
      id: 'bad',
      at: Date.now(),
      type: 'pair.redeem',
      code: 'NOEXISTE',
      deviceName: 'X',
      platform: 'ios',
    });
    const response = await client.next();
    expect(response['code']).toBe('auth-invalid');
    client.close();
  });
});

describe('folders over the WebSocket', () => {
  /** A server whose only difference is how many folders it has. */
  async function withFolders(
    folders: unknown[],
    run: (client: TestClient) => Promise<void>,
  ): Promise<void> {
    const registry = new DeviceRegistry({ persistence: new MemoryPersistence() });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      listSessions: () => Promise.resolve([]),
      listWorkspaces: () => Promise.resolve(folders as never),
    });

    try {
      const client = await openClient(server.port);
      client.send(hello({ deviceToken: token }));
      const ready = await client.next();
      expect(ready['type']).toBe('hello.ok');
      await run(client);
      client.close();
    } finally {
      await server.close();
    }
  }

  it('answers with the folders the host provides', async () => {
    await withFolders(
      [{ id: 'ws-1', title: 'dsh-mobile', directory: 'C:/work', sessionIds: ['s1'] }],
      async (client) => {
        client.send({
          v: PROTOCOL_VERSION,
          id: 'wl',
          at: Date.now(),
          type: 'workspace.list',
        } as never);
        const response = await client.next();
        expect(response['type']).toBe('workspace.ok');
        const workspaces = response['workspaces'] as Array<{ id: string }>;
        expect(workspaces.map((workspace) => workspace.id)).toEqual(['ws-1']);
      },
    );
  });

  it('answers with an empty list when the host has no folders', async () => {
    // This is the host this project had until yesterday: an empty answer, not an error.
    await withFolders([], async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'wl',
        at: Date.now(),
        type: 'workspace.list',
      } as never);
      const response = await client.next();
      expect(response['type']).toBe('workspace.ok');
      expect(response['workspaces']).toEqual([]);
    });
  });
  it('resolves capabilities on every hello, not once at startup', async () => {
    // The workspace controller can mount after the plugin starts, so a capability
    // sampled once lies in both directions.
    let available = false;
    const registry = new DeviceRegistry({ persistence: new MemoryPersistence() });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      listSessions: () => Promise.resolve([]),
      capabilities: () => (available ? ['workspace.list'] : []),
    });

    try {
      const first = await openClient(server.port);
      first.send(hello({ deviceToken: token }));
      const before = await first.next();
      // Sin capacidades el campo no viaja: `undefined`, no una lista vacía.
      expect((before['host'] as { capabilities?: unknown }).capabilities).toEqual([]);
      first.close();

      available = true;

      const second = await openClient(server.port);
      second.send(hello({ deviceToken: token }));
      const after = await second.next();
      expect((after['host'] as { capabilities?: unknown }).capabilities).toEqual([
        'workspace.list',
      ]);
      second.close();
    } finally {
      await server.close();
    }
  });
});

describe('session actions over the WebSocket', () => {
  /** A server whose session actions are whatever the test needs. */
  async function acting(
    deps: {
      createSession?: () => Promise<{
        ok: boolean;
        code?: string;
        message?: string;
        sessionId?: string;
      }>;
      archiveSession?: () => Promise<{ ok: boolean; code?: string; message?: string }>;
    },
    run: (client: TestClient) => Promise<void>,
  ): Promise<void> {
    const registry = new DeviceRegistry({ persistence: new MemoryPersistence() });
    const { token } = registry.enroll('Pixel', 'android');

    const server = await startCompanionServer({
      pairing: new PairingService(),
      devices: registry,
      port: 0,
      listSessions: () => Promise.resolve([]),
      ...(deps.createSession ? { createSession: deps.createSession as never } : {}),
      ...(deps.archiveSession ? { archiveSession: deps.archiveSession as never } : {}),
    });

    try {
      const client = await openClient(server.port);
      client.send(hello({ deviceToken: token }));
      expect((await client.next())['type']).toBe('hello.ok');
      await run(client);
      client.close();
    } finally {
      await server.close();
    }
  }

  it('creates a session and answers with its id', async () => {
    await acting(
      { createSession: async () => ({ ok: true, sessionId: 'new-1' }) },
      async (client) => {
        client.send({
          v: PROTOCOL_VERSION,
          id: 'c1',
          at: Date.now(),
          type: 'session.create',
          workspaceId: 'ws-1',
        } as never);
        const response = await client.next();
        expect(response['type']).toBe('session.created');
        expect(response['sessionId']).toBe('new-1');
      },
    );
  });

  it('answers not-found when the folder is gone', async () => {
    await acting(
      { createSession: async () => ({ ok: false, code: 'no-folder', message: 'gone' }) },
      async (client) => {
        client.send({
          v: PROTOCOL_VERSION,
          id: 'c2',
          at: Date.now(),
          type: 'session.create',
          workspaceId: 'gone',
        } as never);
        const response = await client.next();
        expect(response['type']).toBe('error');
        expect(response['code']).toBe('not-found');
      },
    );
  });

  it('archives and confirms', async () => {
    await acting({ archiveSession: async () => ({ ok: true }) }, async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'a1',
        at: Date.now(),
        type: 'workspace.archive',
        sessionId: 's1',
      } as never);
      const response = await client.next();
      expect(response['type']).toBe('workspace.archived');
      expect(response['sessionId']).toBe('s1');
    });
  });

  it('refuses to answer when the host has no handler wired', async () => {
    // Sin dependencia inyectada el mensaje no puede responderse, y `bad-request` lo dice.
    await acting({}, async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'a2',
        at: Date.now(),
        type: 'workspace.archive',
        sessionId: 's1',
      } as never);
      const response = await client.next();
      expect(response['type']).toBe('error');
      expect(response['code']).toBe('bad-request');
    });
  });

  it('reports a running session as denied, not as an internal failure', async () => {
    // El usuario puede resolver esto parando el turno, así que la app necesita un
    // código propio. Con `internal` no podía distinguirlo de una avería real.
    const response = await archiveFailure({ ok: false, code: 'active', message: 'busy' });
    expect(response['type']).toBe('error');
    expect(response['code']).toBe('denied');
  });

  it('keeps a genuine failure internal', async () => {
    const response = await archiveFailure({ ok: false, code: 'failed', message: 'boom' });
    expect(response['type']).toBe('error');
    expect(response['code']).toBe('internal');
  });

  /** Pide archivar una sesión y devuelve la respuesta del host. */
  async function archiveFailure(result: {
    ok: boolean;
    code?: string;
    message?: string;
  }): Promise<Record<string, unknown>> {
    let received: Record<string, unknown> = {};
    await acting({ archiveSession: async () => result }, async (client) => {
      client.send({
        v: PROTOCOL_VERSION,
        id: 'a3',
        at: Date.now(),
        type: 'workspace.archive',
        sessionId: 's1',
      } as never);
      received = await client.next();
    });
    return received;
  }
});
