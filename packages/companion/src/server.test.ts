import { once } from 'node:events';
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

async function openClient(): Promise<TestClient> {
  const socket = new WebSocket(`ws://${base}${WEBSOCKET_PATH}`);
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

describe('superficie HTTP', () => {
  it('responde /health con el protocolo y los dispositivos', async () => {
    const response = await fetch(`http://${base}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; proto: number; devices: number };
    expect(body.ok).toBe(true);
    expect(body.proto).toBe(PROTOCOL_VERSION);
    expect(body.devices).toBe(0);
  });

  it('sirve el QR de emparejamiento como página', async () => {
    const html = await (await fetch(`http://${base}/pair`)).text();
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('#/pair');
    expect(html).toContain('https://maquina.tailnet.ts.net');
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
