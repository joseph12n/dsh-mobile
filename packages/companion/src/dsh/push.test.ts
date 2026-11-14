import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostContext } from '../host-api.js';
import { createPushService } from './push.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-push-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const subscription = {
  endpoint: 'https://push.example/sub',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

function context(
  items: Array<{
    sessionId: string;
    running?: boolean;
    projections?: { values?: Record<string, unknown>; asOfSeq?: number };
  }> = [],
): HostContext {
  return {
    sessionController: { list: async () => ({ items }) },
    sessions: { list: () => [], get: () => undefined },
    sessionProjections: { snapshot: () => ({ asOfSeq: 0, values: {} }) },
  } as unknown as HostContext;
}

describe('createPushService', () => {
  it('genera y persiste las claves VAPID', () => {
    const dir = tempDir();
    const service = createPushService(context(), {
      dir,
      sender: async () => undefined,
    });

    expect(service.publicKey().length).toBeGreaterThan(20);
    const raw = JSON.parse(readFileSync(join(dir, 'vapid.json'), 'utf8')) as {
      publicKey?: string;
      privateKey?: string;
    };
    expect(raw.publicKey).toBe(service.publicKey());
    expect(typeof raw.privateKey).toBe('string');
  });

  it('guarda, recarga y borra suscripciones por dispositivo', () => {
    const dir = tempDir();
    const first = createPushService(context(), { dir, sender: async () => undefined });
    first.subscribe('device-1', subscription);
    expect(first.subscriptionCount()).toBe(1);

    const second = createPushService(context(), { dir, sender: async () => undefined });
    expect(second.subscriptionCount()).toBe(1);

    second.removeDevice('device-1');
    expect(second.subscriptionCount()).toBe(0);
  });

  it('envía el aviso y descarta una suscripción caducada', async () => {
    const dir = tempDir();
    const payloads: string[] = [];
    const service = createPushService(context(), {
      dir,
      sender: async (_subscription, payload) => {
        payloads.push(payload);
        throw Object.assign(new Error('gone'), { statusCode: 410 });
      },
    });

    service.subscribe('device-1', subscription);
    await service.notifyTurn('session-1', 'Demo');

    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0] ?? '{}')).toMatchObject({
      kind: 'turn',
      sessionId: 'session-1',
    });
    expect(service.subscriptionCount()).toBe(0);
  });

  it('avisa cuando un turno pasa de running a idle', async () => {
    vi.useFakeTimers();
    const dir = tempDir();
    const payloads: string[] = [];
    let running = true;

    const ctx = {
      sessionController: {
        list: async () => ({
          items: [
            {
              sessionId: 'session-1',
              running,
              updatedAt: Date.now(),
              projections: { values: { title: 'Demo' }, asOfSeq: 1 },
            },
          ],
        }),
      },
      sessions: { list: () => [], get: () => undefined },
      sessionProjections: { snapshot: () => ({ asOfSeq: 1, values: {} }) },
    } as unknown as HostContext;

    const service = createPushService(ctx, {
      dir,
      sender: async (_subscription, payload) => {
        payloads.push(payload);
      },
      intervalMs: 1_000,
    });

    service.subscribe('device-1', subscription);
    service.start();
    await vi.advanceTimersByTimeAsync(1_000);

    running = false;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(payloads.length).toBe(1);
    expect(JSON.parse(payloads[0] ?? '{}')).toMatchObject({
      kind: 'turn',
      sessionId: 'session-1',
    });

    service.dispose();
    vi.useRealTimers();
  });
});
