// Verificación de humo de los artefactos compilados: el servidor de dist/ sirviendo
// la PWA de dist/, con emparejamiento y lista de sesiones de punta a punta.
//
//   pnpm build && pnpm smoke
//
// No toca DSH: arranca el servidor con datos de ejemplo en un puerto efímero. Sirve
// para comprobar que el paquete que se publicaría funciona tal cual.
import WebSocket from 'ws';
import { startCompanionServer } from '../packages/companion/dist/server.js';
import { PairingService } from '../packages/companion/dist/core/pairing.js';
import { DeviceRegistry } from '../packages/companion/dist/core/devices.js';

const WEB_ROOT = new URL('../packages/app/dist', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);

const memory = {
  devices: [],
  load() {
    return this.devices;
  },
  save(devices) {
    this.devices = devices;
  },
};

const devices = new DeviceRegistry({ persistence: memory });
const pairing = new PairingService();

const server = await startCompanionServer({
  pairing,
  devices,
  port: 0,
  webRoot: WEB_ROOT,
  listSessions: async () => [
    {
      id: 'demo-1',
      title: 'Sesión de prueba',
      updatedAt: Date.now() - 120_000,
      seq: 7,
      agentAvailable: true,
      running: false,
      pendingQuestions: 2,
    },
  ],
});

const base = `http://127.0.0.1:${server.port}`;
const wsUrl = `ws://127.0.0.1:${server.port}/ws`;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FALLO'} ${label}${detail ? ` · ${detail}` : ''}`);
}

const index = await fetch(`${base}/`);
const indexHtml = await index.text();
check('la PWA se sirve', index.status === 200 && indexHtml.includes('DSH Mobile'));

const manifest = await fetch(`${base}/manifest.webmanifest`);
check(
  'el manifest tiene el tipo correcto',
  manifest.headers.get('content-type')?.includes('manifest+json') === true,
);
check('el manifest se revalida', manifest.headers.get('cache-control') === 'no-cache');

const assetPath = indexHtml.match(/src="([^"]+\.js)"/)?.[1];
if (assetPath) {
  const asset = await fetch(`${base}${assetPath}`);
  check(
    'el asset lleva hash y se cachea para siempre',
    asset.headers.get('cache-control')?.includes('immutable') === true,
  );
}

const pairHtml = await (await fetch(`${base}/pair`)).text();
check('el QR se genera', pairHtml.includes('data:image/png;base64,'));

const code = pairHtml.match(/<code>([^<]+)<\/code>/)?.[1];

function call(frames, want) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('timeout esperando respuesta'));
    }, 5000);

    socket.on('open', () => frames.forEach((frame) => socket.send(JSON.stringify(frame))));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf8'));
      if (message.type === want) {
        clearTimeout(timer);
        socket.close();
        resolve(message);
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const V = 1;
const msg = (type, extra = {}) => ({
  v: V,
  id: `${type}-${Math.random().toString(36).slice(2, 7)}`,
  at: Date.now(),
  type,
  ...extra,
});

const paired = await call(
  [msg('hello', { proto: V }), msg('pair.redeem', { code, deviceName: 'smoke', platform: 'node' })],
  'pair.ok',
);
check('el emparejamiento entrega token', typeof paired.deviceToken === 'string');

const listed = await call(
  [msg('hello', { proto: V, deviceToken: paired.deviceToken }), msg('sessions.list')],
  'sessions.ok',
);
check('la lista de sesiones llega', Array.isArray(listed.sessions) && listed.sessions.length === 1);
check('el estado refleja las preguntas pendientes', listed.sessions[0]?.state === 'waiting');

await server.close();

console.log(failures === 0 ? '\ntodo correcto' : `\n${failures} comprobación(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
