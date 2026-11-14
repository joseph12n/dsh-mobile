import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QuestionBatch, PushSubscription } from '@deepseekharness-mobile/protocol';
import * as webpush from 'web-push';
import type { HostContext } from '../host-api.js';
import { log } from '../log.js';
import { listSessions } from './session-source.js';

const VAPID_FILE = 'vapid.json';
const PUSH_FILE = 'push.json';
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_SUBJECT = 'mailto:dsh-mobile@localhost';

export type PushKind = 'question' | 'turn';

export interface PushPayload {
  kind: PushKind;
  title: string;
  body: string;
  sessionId: string;
}

export type PushSender = (subscription: PushSubscription, payload: string) => Promise<unknown>;

export interface PushService {
  publicKey(): string;
  subscribe(deviceId: string, subscription: PushSubscription): void;
  unsubscribe(deviceId: string): void;
  removeDevice(deviceId: string): void;
  notifyQuestion(batch: QuestionBatch): Promise<void>;
  notifyTurn(sessionId: string, title: string): Promise<void>;
  start(): void;
  dispose(): void;
  subscriptionCount(): number;
}

interface StoredSubscription {
  deviceId: string;
  subscription: PushSubscription;
  createdAt: number;
}

function readVapid(dir: string): { publicKey: string; privateKey: string } {
  const file = join(dir, VAPID_FILE);
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof raw['publicKey'] === 'string' && typeof raw['privateKey'] === 'string') {
      return { publicKey: raw['publicKey'], privateKey: raw['privateKey'] };
    }
  } catch {}

  const keys = webpush.generateVAPIDKeys();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(keys), { encoding: 'utf8', mode: 0o600 });
  log('push: generated VAPID keys');
  return keys;
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

export function createPushService(
  ctx: HostContext,
  options: {
    dir: string;
    sender?: PushSender;
    subject?: string;
    intervalMs?: number;
  },
): PushService {
  const keys = readVapid(options.dir);
  const subject = options.subject ?? process.env.DSH_MOBILE_VAPID_SUBJECT ?? DEFAULT_SUBJECT;
  const file = join(options.dir, PUSH_FILE);

  const load = (): StoredSubscription[] => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      return Array.isArray(raw)
        ? raw.filter(
            (entry): entry is StoredSubscription =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as StoredSubscription).deviceId === 'string',
          )
        : [];
    } catch {
      return [];
    }
  };

  let stored = load();

  const save = (): void => {
    mkdirSync(options.dir, { recursive: true });
    writeFileSync(file, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
  };

  const sender: PushSender =
    options.sender ??
    (async (subscription, payload) => {
      webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          expirationTime: subscription.expirationTime ?? null,
        },
        payload,
      );
    });

  const notify = async (payload: PushPayload): Promise<void> => {
    if (stored.length === 0) return;
    const body = JSON.stringify(payload);

    await Promise.allSettled(
      stored.map(async (entry) => {
        try {
          await sender(entry.subscription, body);
        } catch (error) {
          const status = errorStatus(error);
          if (status === 404 || status === 410) {
            stored = stored.filter(
              (item) => item.subscription.endpoint !== entry.subscription.endpoint,
            );
            save();
            log(`push: dropped an expired subscription for ${entry.deviceId}`);
            return;
          }
          log(`push: delivery failed (${status ?? 'unknown'}) for ${entry.deviceId}`);
        }
      }),
    );
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  const running = new Map<string, boolean>();

  const poll = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    try {
      const sessions = await listSessions(ctx);
      const seen = new Set<string>();

      for (const session of sessions) {
        seen.add(session.id);
        const was = running.get(session.id);
        if (was === true && !session.running) {
          void notify({
            kind: 'turn',
            title: 'DSH Mobile',
            body: `The turn finished: ${session.title}`,
            sessionId: session.id,
          });
        }
        running.set(session.id, session.running);
      }

      for (const id of [...running.keys()]) {
        if (!seen.has(id)) running.delete(id);
      }
    } catch {
      // The sessions service may not be ready during startup; the next poll retries.
    } finally {
      polling = false;
    }
  };

  const service: PushService = {
    publicKey: () => keys.publicKey,

    subscribe(deviceId, subscription) {
      stored = stored.filter(
        (entry) =>
          entry.deviceId !== deviceId && entry.subscription.endpoint !== subscription.endpoint,
      );
      stored.push({ deviceId, subscription, createdAt: Date.now() });
      save();
    },

    unsubscribe(deviceId) {
      stored = stored.filter((entry) => entry.deviceId !== deviceId);
      save();
    },

    removeDevice(deviceId) {
      stored = stored.filter((entry) => entry.deviceId !== deviceId);
      save();
    },

    async notifyQuestion(batch) {
      await notify({
        kind: 'question',
        title: 'DSH Mobile',
        body: 'The agent is waiting for your answer',
        sessionId: batch.sessionId,
      });
    },

    async notifyTurn(sessionId, title) {
      await notify({
        kind: 'turn',
        title: 'DSH Mobile',
        body: `The turn finished: ${title}`,
        sessionId,
      });
    },

    start() {
      if (timer) return;
      void poll();
      timer = setInterval(() => {
        void poll();
      }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
      if (typeof timer.unref === 'function') timer.unref();
    },

    dispose() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },

    subscriptionCount: () => stored.length,
  };

  return service;
}
