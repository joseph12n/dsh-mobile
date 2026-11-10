import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  WEBSOCKET_PATH,
  newMessageId,
  parseClientMessage,
  type Capability,
  type ServerMessage,
} from '@dsh-mobile/protocol';
import { log } from './log.js';
import type { ProbeReport } from './probe.js';

/**
 * Listener propio del plugin (spike E0.4).
 *
 * Escucha **solo en loopback**: la exposición por tailnet es otra fase y exige
 * primero autenticación por dispositivo. Aquí lo único que se demuestra es que
 * el plugin puede abrir su socket, diferenciarse del servidor web de DSH y
 * hablar el contrato real.
 */

export const DEFAULT_PORT = 6768;
const HOST = '127.0.0.1';

export interface ServerOptions {
  port?: number;
  /** Informe bajo demanda para `GET /probe`. */
  report?: () => ProbeReport;
  capabilities?: Capability[];
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function requestIdOf(endpoint: string): string {
  return `http:${endpoint}:${newMessageId()}`;
}

/**
 * Arranca el listener. Devuelve un manejador de cierre; si algo falla, el
 * llamador decide (el plugin registra y sigue vivo).
 */
export function startCompanionServer(options: ServerOptions = {}): Promise<RunningServer> {
  const port = options.port ?? DEFAULT_PORT;
  const capabilities = options.capabilities ?? [];

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          name: 'dsh-mobile-companion',
          proto: PROTOCOL_VERSION,
          capabilities,
        }),
      );
      return;
    }

    if (url === '/probe' && options.report) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(options.report(), null, 2));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not-found', path: url }));
  });

  const wss = new WebSocketServer({
    server: http,
    path: WEBSOCKET_PATH,
    maxPayload: MAX_FRAME_BYTES,
  });

  wss.on('connection', (socket: WebSocket) => {
    log('una conexión WebSocket se abrió');

    socket.on('message', (data: Buffer) => {
      const message = parseClientMessage(data.toString('utf8'));

      if (!message) {
        send(socket, {
          v: PROTOCOL_VERSION,
          id: requestIdOf('bad-request'),
          at: Date.now(),
          type: 'error',
          code: 'bad-request',
          message: 'El marco no valida contra el esquema.',
        });
        return;
      }

      if (message.type === 'ping') {
        send(socket, { v: PROTOCOL_VERSION, id: message.id, at: Date.now(), type: 'pong' });
        return;
      }

      // Sin canje de emparejamiento no hay token: el spike solo responde a `hello`.
      if (message.type === 'hello') {
        const now = Date.now();
        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: now,
          type: 'hello.ok',
          host: {
            id: 'spike-host',
            name: 'DSH Mobile (spike)',
            version: '0.0.0',
            platform: process.platform,
            capabilities,
          },
          device: {
            id: 'spike-device',
            name: message.clientName ?? 'spike',
            createdAt: now,
            lastSeenAt: now,
          },
        });
        return;
      }

      send(socket, {
        v: PROTOCOL_VERSION,
        id: message.id,
        at: Date.now(),
        type: 'error',
        code: 'auth-required',
        message: `Sin dispositivo emparejado, ${message.type} no está disponible.`,
      });
    });

    socket.on('error', (error: Error) => log(`error de WebSocket: ${error.message}`));
    socket.on('close', () => log('una conexión WebSocket se cerró'));
  });

  return new Promise<RunningServer>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, HOST, () => {
      const address = http.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      log(`listener escuchando en http://${HOST}:${bound} (ws ${WEBSOCKET_PATH})`);

      resolve({
        port: bound,
        async close() {
          for (const client of wss.clients) client.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          await new Promise<void>((done) => http.close(() => done()));
        },
      });
    });
  });
}
