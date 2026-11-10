import { hostname } from 'node:os';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_FRAME_BYTES,
  MAX_FRAMES_PER_MINUTE,
  PROTOCOL_VERSION,
  WEBSOCKET_PATH,
  buildPairingUrl,
  isSupportedVersion,
  newMessageId,
  parseClientMessage,
  type Capability,
  type DeviceInfo,
  type HostInfo,
  type ServerMessage,
} from '@dsh-mobile/protocol';
import type { Device, DeviceRegistry } from './core/devices.js';
import type { PairingService } from './core/pairing.js';
import { log } from './log.js';
import type { ProbeReport } from './probe.js';

/**
 * Listener propio del plugin.
 *
 * Escucha **solo en loopback**. La exposición por tailnet es un paso posterior y
 * consiste en poner delante un proxy TLS; el servidor no cambia.
 *
 * Autenticación: cada conexión empieza sin dispositivo. `hello` valida el token
 * si lo trae, y `pair.redeem` canjea un código de un solo uso. Cualquier otro
 * mensaje sin dispositivo acreditado se rechaza con `auth-required`.
 */

export const DEFAULT_PORT = 6768;
const HOST = '127.0.0.1';

export interface ServerDeps {
  pairing: PairingService;
  devices: DeviceRegistry;
  port?: number;
  /** Origen público donde se sirve la PWA. Se usa para construir el QR. */
  publicUrl?: string;
  capabilities?: Capability[];
  report?: () => ProbeReport;
}

export interface RunningServer {
  port: number;
  publicUrl: string;
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

/** Página de emparejamiento: muestra el QR y el código por si hay que teclearlo. */
function pairingPage(link: string, code: string, expiresAt: number, qrDataUrl: string): string {
  return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Emparejar DSH Mobile</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#0b0f14; color:#e6edf3;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { text-align:center; padding:32px 24px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#8b9bab; margin:0 0 24px; font-size:14px; }
  img { width:min(320px,80vw); height:auto; background:#fff; border-radius:16px; padding:12px; }
  code { display:block; margin:20px auto 0; font-size:15px; letter-spacing:2px; color:#4ade80; word-break:break-all; }
  small { display:block; margin-top:12px; color:#8b9bab; }
</style>
<main>
  <h1>Emparejar DSH Mobile</h1>
  <p>Escanea este código con la cámara del teléfono.</p>
  <img src="${qrDataUrl}" alt="Código QR de emparejamiento">
  <code>${escapeHtml(code)}</code>
  <small>Caduca a las ${escapeHtml(new Date(expiresAt).toLocaleTimeString())} · un solo uso</small>
  <small>${escapeHtml(link)}</small>
</main>
</html>`;
}

export function startCompanionServer(deps: ServerDeps): Promise<RunningServer> {
  const { pairing, devices } = deps;
  const capabilities = deps.capabilities ?? [];
  const requestedPort = deps.port ?? DEFAULT_PORT;

  const hostInfo: HostInfo = {
    id: hostname(),
    name: 'DSH Mobile',
    version: '0.1.0',
    platform: process.platform,
    capabilities,
  };

  // Se conoce al escuchar; mientras tanto vale el puerto pedido.
  let listeningPort = requestedPort;
  const publicOrigin = (): string => deps.publicUrl ?? `http://${HOST}:${listeningPort}`;

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const json = { 'content-type': 'application/json; charset=utf-8' };

    if (url === '/health') {
      res.writeHead(200, json);
      res.end(
        JSON.stringify({
          ok: true,
          name: 'dsh-mobile-companion',
          proto: PROTOCOL_VERSION,
          capabilities,
          devices: devices.list().length,
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
      // Reutiliza el código vigente si lo hay: recargar la página no debe
      // invalidar el QR que ya está en pantalla.
      const existing = pairing.pending()[0] ?? pairing.issue();
      const link = buildPairingUrl(publicOrigin(), existing.code);

      void QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
        .then((dataUrl) => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(pairingPage(link, existing.code, existing.expiresAt, dataUrl));
        })
        .catch((error: unknown) => {
          log(`no pude generar el QR: ${String(error)}`);
          res.writeHead(500, json);
          res.end(JSON.stringify({ error: 'qr-failed' }));
        });
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

  wss.on('connection', (socket: WebSocket) => {
    const connection: Connection = {
      device: undefined,
      sawHello: false,
      frameCount: 0,
      windowStart: Date.now(),
    };

    log('conexión abierta');

    socket.on('message', (data: Buffer) => {
      // Límite por ventana de un minuto, contra un cliente defectuoso.
      const now = Date.now();
      if (now - connection.windowStart > 60_000) {
        connection.windowStart = now;
        connection.frameCount = 0;
      }
      connection.frameCount += 1;
      if (connection.frameCount > MAX_FRAMES_PER_MINUTE) {
        send(socket, errorMessage(newMessageId(), 'rate-limited', 'Demasiados marcos por minuto.'));
        socket.close();
        return;
      }

      const message = parseClientMessage(data.toString('utf8'));
      if (!message) {
        send(
          socket,
          errorMessage(newMessageId(), 'bad-request', 'El marco no valida contra el esquema.'),
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
              `Este host habla dsh-mobile/${PROTOCOL_VERSION}; pediste ${message.proto}.`,
              capabilities,
            ),
          );
          socket.close();
          return;
        }

        connection.sawHello = true;

        if (message.deviceToken) {
          const device = devices.authenticate(message.deviceToken);
          if (!device) {
            send(
              socket,
              errorMessage(message.id, 'auth-invalid', 'El token de dispositivo no es válido.'),
            );
            return;
          }
          connection.device = device;
        }

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'hello.ok',
          host: hostInfo,
          ...(connection.device ? { device: toDeviceInfo(connection.device) } : {}),
        });
        return;
      }

      if (message.type === 'pair.redeem') {
        if (!connection.sawHello) {
          send(
            socket,
            errorMessage(message.id, 'auth-required', 'Manda `hello` antes de emparejar.'),
          );
          return;
        }

        const outcome = pairing.redeem(message.code);
        if (outcome !== 'ok') {
          const reason =
            outcome === 'expired'
              ? 'El código caducó. Genera uno nuevo en el escritorio.'
              : outcome === 'consumed'
                ? 'Ese código ya se usó. Genera uno nuevo.'
                : 'Código desconocido.';
          send(socket, errorMessage(message.id, 'auth-invalid', reason));
          return;
        }

        const enrolled = devices.enroll(message.deviceName, message.platform);
        connection.device = enrolled.device;
        log(`dispositivo emparejado: ${enrolled.device.name} (${enrolled.device.platform})`);

        send(socket, {
          v: PROTOCOL_VERSION,
          id: message.id,
          at: Date.now(),
          type: 'pair.ok',
          deviceToken: enrolled.token,
          host: hostInfo,
          device: toDeviceInfo(enrolled.device),
        });
        return;
      }

      // Todo lo demás exige un dispositivo acreditado.
      if (!connection.device) {
        send(
          socket,
          errorMessage(
            message.id,
            'auth-required',
            `Sin dispositivo emparejado, ${message.type} no está disponible.`,
          ),
        );
        return;
      }

      send(
        socket,
        errorMessage(
          message.id,
          'bad-request',
          `${message.type} todavía no está implementado en este build.`,
        ),
      );
    });

    socket.on('error', (error: Error) => log(`error de WebSocket: ${error.message}`));
    socket.on('close', () => log('conexión cerrada'));
  });

  return new Promise<RunningServer>((resolve, reject) => {
    http.once('error', reject);
    http.listen(requestedPort, HOST, () => {
      const address = http.address();
      listeningPort =
        typeof address === 'object' && address !== null ? address.port : requestedPort;
      log(`listener escuchando en ${publicOrigin()} (ws ${WEBSOCKET_PATH})`);

      resolve({
        port: listeningPort,
        publicUrl: publicOrigin(),
        async close() {
          for (const client of wss.clients) client.terminate();
          await new Promise<void>((done) => wss.close(() => done()));
          await new Promise<void>((done) => http.close(() => done()));
        },
      });
    });
  });
}
