// Servidor de vista previa para revisar el diseño sin DSH.
//
//   node scripts/preview-server.mjs [puerto]
//
// Sirve la PWA compilada con las piezas de host reales (emparejamiento,
// dispositivos en memoria) y datos de ejemplo, para poder mirar la interfaz en
// un navegador. No toca DSH ni el disco.
import { startCompanionServer } from '../packages/companion/dist/server.js';
import { findWebRoot } from '../packages/companion/dist/routes/web-root.js';
import { PairingService } from '../packages/companion/dist/core/pairing.js';
import { DeviceRegistry } from '../packages/companion/dist/core/devices.js';

const port = Number(process.argv[2] ?? 6799);
const memory = {
  devices: [],
  load() {
    return this.devices;
  },
  save(devices) {
    this.devices = devices;
  },
};

const now = Date.now();

const devices = new DeviceRegistry({ persistence: memory });

// Dispositivo ya emparejado: el token se imprime para poder inyectarlo en el
// navegador y mirar las pantallas sin pasar por el QR.
const preview = devices.enroll('Vista previa', 'preview');

const server = await startCompanionServer({
  pairing: new PairingService(),
  devices,
  port,
  webRoot: findWebRoot(),
  listSessions: async () => [
    {
      id: 'session-a',
      title: 'Arreglar el despliegue de producción',
      updatedAt: now - 2 * 60 * 1000,
      seq: 412,
      agentAvailable: true,
      running: true,
      pendingQuestions: 0,
    },
    {
      id: 'session-b',
      title: 'Revisar la migración de la base de datos',
      updatedAt: now - 14 * 60 * 1000,
      seq: 120,
      agentAvailable: true,
      running: false,
      pendingQuestions: 2,
    },
    {
      id: 'session-c',
      title: 'Documentar la API de facturación',
      updatedAt: now - 3 * 60 * 60 * 1000,
      seq: 88,
      agentAvailable: true,
      running: false,
      pendingQuestions: 0,
    },
  ],
  listQuestions: () => [
    {
      callId: 'call-1',
      sessionId: 'session-b',
      state: 'open',
      createdAt: now,
      items: [
        {
          id: 'q1',
          text: '¿Aplico la migración sobre la base de producción?',
          header: 'confirmación',
          detail: 'ALTER TABLE facturas ADD COLUMN conciliada BOOLEAN DEFAULT FALSE;',
          options: [{ label: 'Sí, adelante' }, { label: 'No', description: 'la reviso antes' }],
          multiSelect: false,
          allowCustom: true,
        },
      ],
    },
  ],
  readHistory: async () => ({
    entries: [
      {
        seq: 1,
        at: now - 60_000,
        event: { kind: 'message', role: 'user', text: '¿Cómo va la migración?' },
      },
      {
        seq: 2,
        at: now - 55_000,
        event: {
          kind: 'tool',
          name: 'read',
          summary: 'db/migrations/0042_conciliada.sql',
          status: 'ok',
        },
      },
      {
        seq: 3,
        at: now - 50_000,
        event: {
          kind: 'message',
          role: 'assistant',
          text: 'Lista. Añade la columna `conciliada` y es idempotente. Antes de aplicarla quiero confirmar que el respaldo está hecho.',
        },
      },
    ],
    hasMore: false,
  }),
  subscribeSession: () => ({ stop: () => undefined }),
  sendReply: async () => ({ ok: true }),
  cancelRun: () => true,
  answerQuestion: () => ({ ok: true }),
});

console.log(`vista previa en http://127.0.0.1:${server.port}/`);
console.log(`token de vista previa: ${preview.token}`);
console.log('Ctrl+C para parar');
