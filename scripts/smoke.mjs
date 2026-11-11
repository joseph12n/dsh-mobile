// Verificación de humo de los artefactos compilados: el servidor de dist/ sirviendo
// la PWA de dist/, con emparejamiento, sesiones y preguntas de punta a punta.
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
      pendingQuestions: 1,
    },
  ],
  listQuestions: () => [
    {
      callId: 'call-demo',
      sessionId: 'demo-1',
      state: 'open',
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
    },
  ],
  answerQuestion: () => ({ ok: true }),
  readHistory: async () => ({
    entries: [
      { seq: 4, at: 1_700_000_000_000, event: { kind: 'message', role: 'user', text: 'hola' } },
    ],
    hasMore: false,
  }),
  subscribeSession: (_sessionId, options) => {
    setTimeout(
      () =>
        options.onEvent({
          seq: 5,
          at: 1_700_000_000_500,
          event: { kind: 'state', state: 'working' },
        }),
      10,
    );
    return { stop: () => undefined };
  },
  cancelRun: () => true,
  sendReply: async () => ({ ok: true }),
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

const manifestJson = await manifest.json();
const sizes = new Set(manifestJson.icons.map((icon) => icon.sizes));
// Chromium exige estos dos tamaños en PNG para ofrecer el aviso de instalación.
check('el manifest declara iconos de 192 y 512', sizes.has('192x192') && sizes.has('512x512'));

// No basta con el tamaño: sin `type: image/png` el navegador puede descartarlo.
for (const size of ['192x192', '512x512']) {
  const entry = manifestJson.icons.find((icon) => icon.sizes === size);
  check(`el icono ${size} es PNG`, entry?.type === 'image/png' && entry.src.endsWith('.png'));
}

// Android recorta con formas arbitrarias: sin una variante maskable, el lanzador
// mete el icono en un cuadrado blanco.
check(
  'hay una variante maskable',
  manifestJson.icons.some((icon) => String(icon.purpose ?? '').includes('maskable')),
);

for (const icon of manifestJson.icons.filter((entry) => entry.src.endsWith('.png'))) {
  const response = await fetch(`${base}${icon.src}`);
  check(
    `el icono ${icon.src} se sirve`,
    response.status === 200 && response.headers.get('content-type') === 'image/png',
  );
}

// iOS no lee el manifest: lo referencia el HTML, y si falta, el icono no aparece.
check('el apple-touch-icon se sirve', (await fetch(`${base}/apple-touch-icon.png`)).status === 200);

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

/** Envía marcos y resuelve cuando llegaron todos los tipos pedidos. */
function collect(frames, wanted) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const seen = [];
    const pending = new Set(wanted);

    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`timeout; llegaron: ${seen.map((m) => m.type).join(', ') || 'nada'}`));
    }, 5000);

    socket.on('open', () => frames.forEach((frame) => socket.send(JSON.stringify(frame))));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf8'));
      seen.push(message);
      pending.delete(message.type);
      if (message.type === 'error' && pending.size > 0) {
        clearTimeout(timer);
        socket.close();
        reject(new Error(`error del host: ${message.code} ${message.message}`));
        return;
      }
      if (pending.size === 0) {
        clearTimeout(timer);
        socket.close();
        resolve(seen);
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

const paired = await collect(
  [msg('hello', { proto: V }), msg('pair.redeem', { code, deviceName: 'smoke', platform: 'node' })],
  ['pair.ok'],
);
const token = paired.find((message) => message.type === 'pair.ok').deviceToken;
check('el emparejamiento entrega token', typeof token === 'string');

const listed = await collect(
  [msg('hello', { proto: V, deviceToken: token }), msg('sessions.list')],
  ['sessions.ok', 'question.pending'],
);
const sessions = listed.find((message) => message.type === 'sessions.ok').sessions;
const question = listed.find((message) => message.type === 'question.pending').question;

check('la lista de sesiones llega', Array.isArray(sessions) && sessions.length === 1);
check('el estado refleja las preguntas pendientes', sessions[0]?.state === 'waiting');
check(
  'el lote de preguntas se empuja',
  question?.callId === 'call-demo' && question.items.length === 1,
);

const answered = await collect(
  [
    msg('hello', { proto: V, deviceToken: token }),
    msg('question.answer', {
      callId: 'call-demo',
      sessionId: 'demo-1',
      answers: [{ id: 'q1', selected: ['Sí'] }],
    }),
  ],
  ['answer.ok'],
);
check(
  'la respuesta se confirma',
  answered.find((message) => message.type === 'answer.ok')?.callId === 'call-demo',
);

const history = await collect(
  [msg('hello', { proto: V, deviceToken: token }), msg('session.history', { sessionId: 'demo-1' })],
  ['history.ok'],
);
const page = history.find((message) => message.type === 'history.ok');
check('el historial llega con su página', page?.entries?.length === 1 && page.hasMore === false);

const streamed = await collect(
  [
    msg('hello', { proto: V, deviceToken: token }),
    msg('session.subscribe', { sessionId: 'demo-1', since: 0 }),
  ],
  ['session.ok', 'session.event'],
);
check(
  'la suscripción confirma',
  streamed.some((message) => message.type === 'session.ok'),
);
check(
  'y empuja eventos vivos',
  streamed.find((message) => message.type === 'session.event')?.seq === 5,
);

const cancelled = await collect(
  [msg('hello', { proto: V, deviceToken: token }), msg('run.cancel', { sessionId: 'demo-1' })],
  ['run.ok'],
);
check(
  'la cancelación se confirma',
  cancelled.some((message) => message.type === 'run.ok'),
);

const written = await collect(
  [
    msg('hello', { proto: V, deviceToken: token }),
    msg('reply.send', { sessionId: 'demo-1', text: 'hola desde el humo' }),
  ],
  ['reply.ok'],
);
check(
  'el texto enviado se confirma',
  written.some((message) => message.type === 'reply.ok'),
);

await server.close();

console.log(failures === 0 ? '\ntodo correcto' : `\n${failures} comprobación(es) fallida(s)`);
process.exit(failures === 0 ? 0 : 1);
