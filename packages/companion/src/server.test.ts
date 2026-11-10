import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, WEBSOCKET_PATH, parseServerMessage } from '@dsh-mobile/protocol';
import { startCompanionServer, type RunningServer } from './server.js';

/**
 * Spike E0.4: el plugin abre su propio listener y habla el contrato real.
 *
 * Un cliente WebSocket de verdad, contra un servidor de verdad, en un puerto
 * efímero. Sin DSH de por medio: aquí se prueba la capa de red, no los servicios
 * del host.
 */

let running: RunningServer;
let base: string;

beforeAll(async () => {
  running = await startCompanionServer({
    port: 0,
    capabilities: ['reply.send'],
    report: () => ({
      timestamp: 'test',
      services: {},
      sessionCount: 0,
      sessions: [],
      injectionCandidates: {},
    }),
  });
  base = `127.0.0.1:${running.port}`;
});

afterAll(async () => {
  await running.close();
});

/** Abre un socket, envía un marco y espera la primera respuesta válida. */
function roundTrip(payload: unknown, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${base}${WEBSOCKET_PATH}`);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('timeout esperando respuesta'));
    }, timeoutMs);

    socket.on('open', () => socket.send(JSON.stringify(payload)));
    socket.on('message', (data: Buffer) => {
      clearTimeout(timer);
      const parsed = parseServerMessage(data.toString('utf8'));
      socket.close();
      if (!parsed) {
        reject(new Error(`respuesta fuera de contrato: ${data.toString('utf8')}`));
        return;
      }
      resolve(parsed);
    });
    socket.on('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('listener propio del plugin', () => {
  it('expone /health', async () => {
    const response = await fetch(`http://${base}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; proto: number };
    expect(body.ok).toBe(true);
    expect(body.proto).toBe(PROTOCOL_VERSION);
  });

  it('devuelve 404 en una ruta desconocida', async () => {
    const response = await fetch(`http://${base}/no-existe`);
    expect(response.status).toBe(404);
  });
});

describe('contrato sobre WebSocket', () => {
  it('responde ping con pong conservando el id', async () => {
    const response = (await roundTrip({
      v: PROTOCOL_VERSION,
      id: 'ping-1',
      at: Date.now(),
      type: 'ping',
    })) as { type: string; id: string };

    expect(response.type).toBe('pong');
    expect(response.id).toBe('ping-1');
  });

  it('responde hello con la identidad del host', async () => {
    const response = (await roundTrip({
      v: PROTOCOL_VERSION,
      id: 'hello-1',
      at: Date.now(),
      type: 'hello',
      proto: PROTOCOL_VERSION,
      clientName: 'test',
    })) as { type: string; host?: { capabilities: string[] } };

    expect(response.type).toBe('hello.ok');
    expect(response.host?.capabilities).toContain('reply.send');
  });

  it('rechaza un marco fuera de contrato con bad-request', async () => {
    const response = (await roundTrip({ hola: 'mundo' })) as { type: string; code?: string };
    expect(response.type).toBe('error');
    expect(response.code).toBe('bad-request');
  });

  it('exige emparejamiento para los comandos de sesión', async () => {
    const response = (await roundTrip({
      v: PROTOCOL_VERSION,
      id: 'list-1',
      at: Date.now(),
      type: 'sessions.list',
    })) as { type: string; code?: string };

    expect(response.type).toBe('error');
    expect(response.code).toBe('auth-required');
  });
});
