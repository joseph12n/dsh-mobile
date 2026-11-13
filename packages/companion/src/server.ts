import { hostname } from 'node:os';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_FRAME_BYTES,
  MAX_FRAMES_PER_MINUTE,
  PROTOCOL_VERSION,
  WEBSOCKET_PATH,
  buildPairingUrl,
  isSupportedVersion,
  newMessageId,
  parseClientMessage,
  type Capability,
  type CommandInfo,
  type CommandResult,
  type DeviceInfo,
  type HistoryEntry,
  type HostInfo,
  type ModelCatalog,
  type ModelSelection,
  type QuestionAnswerItem,
  type QuestionBatch,
  type ServerMessage,
  type SessionActivity,
  type Workspace,
} from '@dsh-mobile/protocol';
import type { Device, DeviceRegistry } from './core/devices.js';
import type { PairingService } from './core/pairing.js';
import { log } from './log.js';
import type { ProbeReport } from './probe.js';
import { serveStatic } from './routes/static.js';
import {
  noticeHeadline,
  originNotice,
  publicOriginFor,
  type OriginNotice,
} from './routes/origin.js';
import { toWireSession, type SessionRecord } from './dsh/session-source.js';

export const DEFAULT_PORT = 6768;
const HOST = '127.0.0.1';

type CommandFailureCode = 'not-found' | 'bad-request' | 'internal';

export interface ServerLimits {
  maxConnections: number;
  maxDevices: number;
  handshakeTimeoutMs: number;
  heartbeatIntervalMs: number;
  flushIntervalMs: number;
}

const DEFAULT_LIMITS: ServerLimits = {
  maxConnections: 50,
  maxDevices: 32,
  handshakeTimeoutMs: 10_000,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  flushIntervalMs: 30_000,
};

export function reapIdleClients(
  clients: Iterable<{ ping(): void; terminate(): void }>,
  alive: WeakSet<object>,
): void {
  for (const client of clients) {
    if (!alive.has(client)) {
      client.terminate();
      continue;
    }
    alive.delete(client);
    try {
      client.ping();
    } catch {}
  }
}

export interface ServerDeps {
  pairing: PairingService;
  devices: DeviceRegistry;
  limits?: Partial<ServerLimits>;
  port?: number;
  publicUrl?: string;
  capabilities?: Capability[] | (() => Capability[]);
  report?: () => ProbeReport;
  webRoot?: string;
  listWorkspaces?: () => Promise<Workspace[]>;

  createSession?: (request: { workspaceId: string }) => Promise<{
    ok: boolean;
    code?: 'no-service' | 'no-folder' | 'failed';
    message?: string;
    sessionId?: string;
  }>;

  archiveSession?: (request: { sessionId: string; stopActivity?: boolean }) => Promise<{
    ok: boolean;
    code?: 'no-service' | 'active' | 'not-found' | 'failed';
    message?: string;
  }>;

  unarchiveSession?: (request: { sessionId: string }) => Promise<{
    ok: boolean;
    code?: 'no-service' | 'not-found' | 'failed';
    message?: string;
  }>;

  listModels?: () => Promise<ModelCatalog>;

  selectModel?: (request: {
    sessionId: string;
    provider: string;
    model: string;
    reasoningEffort?: string;
  }) => Promise<{
    ok: boolean;
    code?: 'no-service' | 'unavailable' | 'not-found' | 'failed';
    message?: string;
    selection?: ModelSelection;
  }>;

  listSessions?: (options: { includeArchived?: boolean }) => Promise<SessionRecord[]>;
  listQuestions?: () => QuestionBatch[];
  listCommands?: (sessionId: string) => CommandInfo[] | Promise<CommandInfo[]>;
  runCommand?: (input: { sessionId: string; line: string }) => Promise<{
    ok: boolean;
    code?: CommandFailureCode;
    message?: string;
    result?: CommandResult;
  }>;
  readActivity?: (sessionId: string) => SessionActivity | Promise<SessionActivity>;
  answerQuestion?: (input: {
    callId: string;
    sessionId: string;
    answers: QuestionAnswerItem[];
  }) => { ok: boolean; code?: CommandFailureCode; message?: string };
  readHistory?: (
    sessionId: string,
    options: { before?: number; limit?: number },
  ) => Promise<{ entries: HistoryEntry[]; hasMore: boolean }>;
  subscribeSession?: (
    sessionId: string,
    options: { since?: number; onEvent: (entry: HistoryEntry) => void; onEnd?: () => void },
  ) => { stop(): void };
  cancelRun?: (sessionId: string) => boolean;
  sendReply?: (
    sessionId: string,
    text: string,
  ) => Promise<{ ok: boolean; message?: string; code?: 'not-found' | 'bad-request' | 'internal' }>;
}

export interface RunningServer {
  port: number;
  publicUrl: string;
  broadcast(message: ServerMessage): void;
  clientCount(): number;
  close(): Promise<void>;
}

interface Connection {
  device: Device | undefined;
  sawHello: boolean;
  frameCount: number;
  windowStart: number;
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function errorMessage(
  id: string,
  code: Extract<ServerMessage, { type: 'error' }>['code'],
  message: string,
  capabilities?: Capability[],
): ServerMessage {
  return {
    v: PROTOCOL_VERSION,
    id,
    at: Date.now(),
    type: 'error',
    code,
    message,
    ...(capabilities ? { capabilities } : {}),
  };
}

function toDeviceInfo(device: Device): DeviceInfo {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pairingPage(
  link: string,
  code: string,
  expiresAt: number,
  qrDataUrl: string,
  notice?: OriginNotice,
): string {
  const banner = notice
    ? `<div class="warn ${notice.severity}"><strong>${escapeHtml(noticeHeadline(notice))}</strong><br>${escapeHtml(notice.message)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair DSH Mobile</title>
<style>
  @font-face {
    font-family: 'Montserrat';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: url(/fonts/montserrat-regular.woff2) format('woff2');
  }
  :root { color-scheme: dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#151517; color:#f9fafb;
         font-family: 'Montserrat', system-ui, -apple-system, "Segoe UI", sans-serif; font-weight:400; }
  main { text-align:center; padding:32px 24px; max-width:560px; }
  h1 { font-size:20px; font-weight:500; margin:0 0 8px; }
  p { color:#adb2b8; margin:0 0 24px; font-size:14px; }
  .warn { text-align:left; margin:0 0 20px; padding:12px 14px; border-radius:12px;
          border:1px solid color-mix(in srgb, #f25a5a 55%, transparent); background:#1f1416; color:#f25a5a;
          font-size:13px; line-height:1.5; }
  .warn.warning { border-color: color-mix(in srgb, #f59e0b 55%, transparent); background:#1c1508; color:#f59e0b; }
  img { width:min(320px,80vw); height:auto; background:#fff; border-radius:16px; padding:12px; }
  code { display:block; margin:20px auto 0; font-size:15px; letter-spacing:2px; color:#f9fafb;
         font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; word-break:break-all; }
  small { display:block; margin-top:12px; color:#adb2b8; }
  small.link { word-break:break-all; }
</style>
<main>
  ${banner}
  <h1>Pair DSH Mobile</h1>
  <p>Scan this code with your phone camera.</p>
  <img src="${qrDataUrl}" alt="Pairing QR code">
  <code>${escapeHtml(code)}</code>
  <small>Expires at ${escapeHtml(new Date(expiresAt).toLocaleTimeString())} · single use</small>
  <small class="link">${escapeHtml(link)}</small>
</main>
</html>`;
}

export function startCompanionServer(deps: ServerDeps): Promise<RunningServer> {
  const { pairing, devices } = deps;
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const capabilities = (): Capability[] =>
    typeof deps.capabilities === 'function' ? deps.capabilities() : (deps.capabilities ?? []);
  const requestedPort = deps.port ?? DEFAULT_PORT;

  const baseHostInfo: Omit<HostInfo, 'capabilities'> = {
    id: hostname(),
    name: 'DSH Mobile',
    version: '0.1.0',
    platform: process.platform,
  };

  let listeningPort = requestedPort;

  const originFor = (req: IncomingMessage): string =>
    publicOriginFor({
      host: req.headers.host,
      forwardedProto: req.headers['x-forwarded-proto'] as string | undefined,
      fallbackPort: listeningPort,
      configured: deps.publicUrl,
    });

  const localOrigin = (): string => deps.publicUrl ?? `http://${HOST}:${listeningPort}`;

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const json = { 'content-type': 'application/json; charset=utf-8' };

    if (url === '/health') {
      const origin = originFor(req);
      const notice = originNotice(origin);

      res.writeHead(200, json);
      res.end(
        JSON.stringify({
          ok: true,
          name: 'dsh-mobile-companion',
          proto: PROTOCOL_VERSION,
          capabilities: capabilities(),
          devices: devices.list().length,
          origin,
          ...(notice ? { warning: notice.message, warningSeverity: notice.severity } : {}),
        }),
      );
      return;
    }

    if (url === '/probe' && deps.report) {
      res.writeHead(200, json);
      res.end(JSON.stringify(deps.report(), null, 2));
      return;
    }

    if (url === '/pair') {
      try {
        const existing = pairing.pending()[0] ?? pairing.issue();
        const origin = originFor(req);
        const link = buildPairingUrl(origin, existing.code);
        const notice = originNotice(origin);

        void QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
          .then((dataUrl) => {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(pairingPage(link, existing.code, existing.expiresAt, dataUrl, notice));
          })
          .catch((error: unknown) => {
            log(`could not generate the QR: ${String(error)}`);
            res.writeHead(500, json);
            res.end(JSON.stringify({ error: 'qr-failed' }));
          });
      } catch (error) {
        log(`/pair failed: ${String(error)}`);
        res.writeHead(400, json);
        res.end(JSON.stringify({ error: 'bad-request' }));
      }
      return;
    }

    const asset = serveStatic(deps.webRoot, url);
    if (asset.status === 200 && asset.body) {
      res.writeHead(200, asset.headers);
      res.end(asset.body);
      return;
    }

    res.writeHead(404, json);
    res.end(JSON.stringify({ error: 'not-found', path: url }));
  });

  const wss = new WebSocketServer({
    server: http,
    path: WEBSOCKET_PATH,
    maxPayload: MAX_FRAME_BYTES,
  });

  wss.on('error', (error: Error) => log(`WebSocket server error: ${error.message}`));

  const clients = new Set<WebSocket>();
  const deviceSockets = new Map<string, Set<WebSocket>>();
  const alive = new WeakSet<object>();

  function trackDevice(socket: WebSocket, device: Device): void {
    clients.add(socket);
    const peers = deviceSockets.get(device.id) ?? new Set<WebSocket>();
    peers.add(socket);
    deviceSockets.set(device.id, peers);
  }

  function untrackDevice(socket: WebSocket): void {
    clients.delete(socket);
    for (const [id, peers] of deviceSockets) {
      if (!peers.delete(socket)) continue;
      if (peers.size === 0) deviceSockets.delete(id);
      break;
    }
  }

  function broadcast(message: ServerMessage): void {
    for (const client of clients) {
      if (client.readyState === client.OPEN) send(client, message);
    }
  }

  wss.on('connection', (socket: WebSocket) => {
    if (wss.clients.size > limits.maxConnections) {
      socket.close(1013, 'too many connections');
      return;
    }

    const connection: Connection = {
      device: undefined,
      sawHello: false,
      frameCount: 0,
      windowStart: Date.now(),
    };

    alive.add(socket);
    socket.on('pong', () => alive.add(socket));

    const handshakeTimer = setTimeout(() => {
      if (!connection.sawHello) socket.close(1008, 'hello timeout');
    }, limits.handshakeTimeoutMs);

    log('connection open');

    const subscriptions = new Map<string, { stop(): void }>();

    socket.on('message', (data: Buffer) => {
      void handleFrame(data).catch((error: unknown) => {
        log(`failed frame: ${String(error)}`);
        if (socket.readyState === socket.OPEN) {
          send(socket, errorMessage(newMessageId(), 'internal', 'Internal host failure.'));
        }
      });
    });

    async function handleFrame(data: Buffer): Promise<void> {
      const now = Date.now();
      if (now - connection.windowStart > 60_000) {
        connection.windowStart = now;
        connection.frameCount = 0;
      }
      connection.frameCount += 1;
      if (connection.frameCount > MAX_FRAMES_PER_MINUTE) {
        send(socket, errorMessage(newMessageId(), 'rate-limited', 'Too many frames per minute.'));
        socket.close();
        return;
      }

      const message = parseClientMessage(data.toString('utf8'));
      if (!message) {
        send(
          socket,
          errorMessage(
            newMessageId(),
            'bad-request',
            'The frame does not validate against the schema.',
          ),
        );
        return;
      }

      if (message.type === 'ping') {
        send(socket, { v: PROTOCOL_VERSION, id: message.id, at: Date.now(), type: 'pong' });
        return;
      }

      if (message.type === 'hello') {
        if (!isSupportedVersion(message.proto)) {
          send(
            socket,
            errorMessage(
              message.id,
              'proto-unsupported',
              `This host speaks dsh-mobile/${PROTOCOL_VERSION}; you asked for ${message.proto}.`,
              capabilities(),
            ),
          );
          socket.close();
          return;
        }

        connection.sawHello = true;
        clearTimeout(handshakeTimer);

        if (message.deviceToken) {
          const device = devices.authenticate(message.deviceToken);
          if (!device) {
            send(
              socket,
              errorMessage(message.id, 'auth-invalid', 'The device token is not valid.'),
            );
            return;
          }
          connection.device = device;
          trackDevice(socket, device);
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'hello.ok',
          host: { ...baseHostInfo, capabilities: capabilities() },
          ...(connection.device ? { device: toDeviceInfo(connection.device) } : {}),
        });
        return;
      }

      if (message.type === 'pair.redeem') {
        if (!connection.sawHello) {
          send(socket, errorMessage(message.id, 'auth-required', 'Send `hello` before pairing.'));
          return;
        }

        if (devices.list().length >= limits.maxDevices) {
          send(
            socket,
            errorMessage(
              message.id,
              'denied',
              'The device limit was reached. Revoke a device and try again.',
            ),
          );
          return;
        }

        const outcome = pairing.redeem(message.code);
        if (outcome !== 'ok') {
          const reason =
            outcome === 'expired'
              ? 'That code expired. Generate a new one on the desktop.'
              : outcome === 'consumed'
                ? 'That code was already used. Generate a new one.'
                : 'Unknown code.';
          send(socket, errorMessage(message.id, 'auth-invalid', reason));
          return;
        }

        const enrolled = devices.enroll(message.deviceName, message.platform);
        connection.device = enrolled.device;
        trackDevice(socket, enrolled.device);
        log(`device paired: ${enrolled.device.name} (${enrolled.device.platform})`);

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'pair.ok',
          deviceToken: enrolled.token,
          host: { ...baseHostInfo, capabilities: capabilities() },
          device: toDeviceInfo(enrolled.device),
        });
        return;
      }

      if (!connection.device) {
        send(
          socket,
          errorMessage(
            message.id,
            'auth-required',
            `Without a paired device, ${message.type} is not available.`,
          ),
        );
        return;
      }

      if (message.type === 'devices.list') {
        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'devices.ok',
          devices: devices.list().map(toDeviceInfo),
        });
        return;
      }

      if (message.type === 'devices.revoke') {
        const target = devices.list().find((device) => device.id === message.deviceId);
        if (!target) {
          send(socket, errorMessage(message.id, 'not-found', 'Unknown device.'));
          return;
        }

        devices.revoke(target.id);
        const updated = devices.list().map(toDeviceInfo);
        const peers = [...(deviceSockets.get(target.id) ?? [])];

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'devices.revoked',
          deviceId: target.id,
        });

        for (const peer of peers) {
          if (peer !== socket) {
            send(peer, {
              v: PROTOCOL_VERSION,
              id: newMessageId(),
              at: Date.now(),
              type: 'devices.revoked',
              deviceId: target.id,
            });
          }
          untrackDevice(peer);
          peer.close(1008, 'revoked');
        }

        broadcast({
          v: PROTOCOL_VERSION,
          id: newMessageId(),
          at: Date.now(),
          type: 'devices.changed',
          devices: updated,
        });
        return;
      }

      if (message.type === 'workspace.list') {
        const workspaces = deps.listWorkspaces ? await deps.listWorkspaces() : [];
        if (socket.readyState !== socket.OPEN) return;

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'workspace.ok',
          workspaces,
        });
        return;
      }

      if (message.type === 'models.list') {
        if (!deps.listModels) {
          send(socket, errorMessage(message.id, 'bad-request', 'This host cannot list models.'));
          return;
        }

        const catalog = await deps.listModels();
        if (socket.readyState !== socket.OPEN) return;

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'models.ok',
          catalog,
        });
        return;
      }

      if (message.type === 'model.select') {
        if (!deps.selectModel) {
          send(socket, errorMessage(message.id, 'bad-request', 'This host cannot select models.'));
          return;
        }

        const selected = await deps.selectModel({
          sessionId: message.sessionId,
          provider: message.provider,
          model: message.model,
          ...(message.reasoningEffort ? { reasoningEffort: message.reasoningEffort } : {}),
        });
        if (socket.readyState !== socket.OPEN) return;

        if (!selected.ok || !selected.selection) {
          send(
            socket,
            errorMessage(
              message.id,
              selected.code === 'unavailable' || selected.code === 'no-service'
                ? 'bad-request'
                : selected.code === 'not-found'
                  ? 'not-found'
                  : 'internal',
              selected.message ?? 'The model could not be changed.',
            ),
          );
          return;
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'model.selected',
          sessionId: message.sessionId,
          selection: selected.selection,
        });
        return;
      }

      if (message.type === 'session.create') {
        if (!deps.createSession) {
          send(
            socket,
            errorMessage(message.id, 'bad-request', 'This host cannot create sessions.'),
          );
          return;
        }

        const created = await deps.createSession({ workspaceId: message.workspaceId });
        if (socket.readyState !== socket.OPEN) return;

        if (!created.ok || !created.sessionId) {
          send(
            socket,
            errorMessage(
              message.id,
              created.code === 'no-service'
                ? 'bad-request'
                : created.code === 'no-folder'
                  ? 'not-found'
                  : 'internal',
              created.message ?? 'The session could not be created.',
            ),
          );
          return;
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'session.created',
          sessionId: created.sessionId,
        });
        return;
      }

      if (message.type === 'workspace.archive') {
        if (!deps.archiveSession) {
          send(
            socket,
            errorMessage(message.id, 'bad-request', 'This host cannot archive sessions.'),
          );
          return;
        }

        const archived = await deps.archiveSession({
          sessionId: message.sessionId,
          ...(message.stopActivity === true ? { stopActivity: true } : {}),
        });
        if (socket.readyState !== socket.OPEN) return;

        if (!archived.ok) {
          send(
            socket,
            errorMessage(
              message.id,
              archived.code === 'active'
                ? 'denied'
                : archived.code === 'not-found'
                  ? 'not-found'
                  : archived.code === 'no-service'
                    ? 'bad-request'
                    : 'internal',
              archived.message ?? 'The session could not be archived.',
            ),
          );
          return;
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'workspace.archived',
          sessionId: message.sessionId,
        });
        return;
      }

      if (message.type === 'workspace.unarchive') {
        if (!deps.unarchiveSession) {
          send(
            socket,
            errorMessage(message.id, 'bad-request', 'This host cannot unarchive sessions.'),
          );
          return;
        }

        const restored = await deps.unarchiveSession({ sessionId: message.sessionId });
        if (socket.readyState !== socket.OPEN) return;

        if (!restored.ok) {
          send(
            socket,
            errorMessage(
              message.id,
              restored.code === 'no-service'
                ? 'bad-request'
                : restored.code === 'not-found'
                  ? 'not-found'
                  : 'internal',
              restored.message ?? 'The session could not be restored.',
            ),
          );
          return;
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'workspace.unarchived',
          sessionId: message.sessionId,
        });
        return;
      }

      if (message.type === 'sessions.list') {
        const records = deps.listSessions
          ? await deps.listSessions({
              ...(message.includeArchived === true ? { includeArchived: true } : {}),
            })
          : [];
        if (socket.readyState !== socket.OPEN) return;

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'sessions.ok',
          sessions: records.map(toWireSession),
        });

        for (const batch of deps.listQuestions?.() ?? []) {
          if (socket.readyState !== socket.OPEN) return;
          send(socket, {
            v: PROTOCOL_VERSION,
            id: newMessageId(),
            at: Date.now(),
            type: 'question.pending',
            question: batch,
          });
        }
        return;
      }

      if (message.type === 'question.answer') {
        if (!deps.answerQuestion) {
          send(
            socket,
            errorMessage(message.id, 'bad-request', 'This host cannot answer questions.'),
          );
          return;
        }

        const outcome = deps.answerQuestion({
          callId: message.callId,
          sessionId: message.sessionId,
          answers: message.answers,
        });

        if (!outcome.ok) {
          send(
            socket,
            errorMessage(
              message.id,
              outcome.code ?? 'internal',
              outcome.message ?? 'Could not answer.',
            ),
          );
          return;
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'answer.ok',
          callId: message.callId,
        });
        return;
      }

      if (message.type === 'commands.list') {
        if (!deps.listCommands) {
          send(
            socket,
            errorMessage(message.id, 'bad-request', 'This host cannot list the commands.'),
          );
          return;
        }

        const commands = await deps.listCommands(message.sessionId);
        if (socket.readyState !== socket.OPEN) return;

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'commands.ok',
          commands,
        });
        return;
      }

      if (message.type === 'command.run') {
        if (!deps.runCommand) {
          send(socket, errorMessage(message.id, 'bad-request', 'This host cannot run commands.'));
          return;
        }

        const outcome = await deps.runCommand({
          sessionId: message.sessionId,
          line: message.line,
        });
        if (socket.readyState !== socket.OPEN) return;

        if (!outcome.ok) {
          send(
            socket,
            errorMessage(
              message.id,
              outcome.code ?? 'internal',
              outcome.message ?? 'The command could not run.',
            ),
          );
          return;
        }

        const result = outcome.result ?? { kind: 'success' as const };
        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'command.ok',
          kind: result.kind,
          ...(result.text !== undefined ? { text: result.text } : {}),
        });
        return;
      }

      if (message.type === 'session.activity') {
        if (!deps.readActivity) {
          send(
            socket,
            errorMessage(message.id, 'bad-request', 'This host cannot read the activity.'),
          );
          return;
        }

        const activity = await deps.readActivity(message.sessionId);
        if (socket.readyState !== socket.OPEN) return;

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'activity.ok',
          sessionId: message.sessionId,
          activity,
        });
        return;
      }

      if (message.type === 'reply.send') {
        if (!deps.sendReply) {
          send(socket, errorMessage(message.id, 'bad-request', 'This host cannot write.'));
          return;
        }

        const outcome = await deps.sendReply(message.sessionId, message.text);
        if (socket.readyState !== socket.OPEN) return;

        if (!outcome.ok) {
          send(
            socket,
            errorMessage(
              message.id,
              outcome.code ?? 'internal',
              outcome.message ?? 'Could not send the message.',
            ),
          );
          return;
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'reply.ok',
          sessionId: message.sessionId,
        });
        return;
      }

      if (message.type === 'session.history') {
        const page = deps.readHistory
          ? await deps.readHistory(message.sessionId, {
              ...(message.before !== undefined ? { before: message.before } : {}),
              ...(message.limit !== undefined ? { limit: message.limit } : {}),
            })
          : { entries: [], hasMore: false };

        if (socket.readyState !== socket.OPEN) return;
        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'history.ok',
          sessionId: message.sessionId,
          entries: page.entries,
          hasMore: page.hasMore,
        });
        return;
      }

      if (message.type === 'session.subscribe') {
        if (!deps.subscribeSession) {
          send(
            socket,
            errorMessage(message.id, 'bad-request', 'This host cannot subscribe to sessions.'),
          );
          return;
        }

        subscriptions.get(message.sessionId)?.stop();

        const subscription = deps.subscribeSession(message.sessionId, {
          ...(message.since !== undefined ? { since: message.since } : {}),
          onEvent: (entry) => {
            if (socket.readyState !== socket.OPEN) return;
            send(socket, {
              v: PROTOCOL_VERSION,
              id: newMessageId(),
              at: Date.now(),
              type: 'session.event',
              sessionId: message.sessionId,
              seq: entry.seq,
              event: entry.event,
            });
          },
          onEnd: () => subscriptions.delete(message.sessionId),
        });

        subscriptions.set(message.sessionId, subscription);

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'session.ok',
          sessionId: message.sessionId,
          seq: message.since ?? 0,
        });
        return;
      }

      if (message.type === 'run.cancel') {
        const accepted = deps.cancelRun?.(message.sessionId) ?? false;
        if (!accepted) {
          send(
            socket,
            errorMessage(message.id, 'not-found', 'No turn is running in that session.'),
          );
          return;
        }
        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'run.ok',
          sessionId: message.sessionId,
          state: 'idle',
        });
        return;
      }

      send(
        socket,
        errorMessage(
          message.id,
          'bad-request',
          `${message.type} is not implemented in this build yet.`,
        ),
      );
    }

    socket.on('error', (error: Error) => log(`WebSocket error: ${error.message}`));
    socket.on('close', () => {
      clearTimeout(handshakeTimer);
      untrackDevice(socket);
      for (const [, subscription] of subscriptions) subscription.stop();
      subscriptions.clear();
      log('connection closed');
    });
  });

  return new Promise<RunningServer>((resolve, reject) => {
    http.once('error', reject);
    http.listen(requestedPort, HOST, () => {
      const address = http.address();
      listeningPort =
        typeof address === 'object' && address !== null ? address.port : requestedPort;
      log(`listener on ${localOrigin()} (ws ${WEBSOCKET_PATH})`);

      const heartbeatTimer = setInterval(
        () => reapIdleClients(wss.clients, alive),
        limits.heartbeatIntervalMs,
      );
      const flushTimer = setInterval(() => devices.flush(), limits.flushIntervalMs);

      resolve({
        port: listeningPort,
        publicUrl: localOrigin(),
        broadcast,
        clientCount() {
          return clients.size;
        },
        async close() {
          clearInterval(heartbeatTimer);
          clearInterval(flushTimer);
          for (const client of wss.clients) client.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          await new Promise<void>((done) => http.close(() => done()));
        },
      });
    });
  });
}
