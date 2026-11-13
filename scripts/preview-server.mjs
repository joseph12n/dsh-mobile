process.env.DSH_MOBILE_LOG_FILE = '0';

const { startCompanionServer } = await import('../packages/companion/dist/server.js');
const { findWebRoot } = await import('../packages/companion/dist/routes/web-root.js');
const { PairingService } = await import('../packages/companion/dist/core/pairing.js');
const { DeviceRegistry } = await import('../packages/companion/dist/core/devices.js');

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

const previewToken = process.env.DSH_MOBILE_PREVIEW_TOKEN;
const devices = new DeviceRegistry({
  persistence: memory,
  ...(previewToken ? { generateToken: () => previewToken } : {}),
});

const preview = devices.enroll('Vista previa', 'preview');

const server = await startCompanionServer({
  pairing: new PairingService(),
  devices,
  port,
  webRoot: findWebRoot(),
  capabilities: ['workspace.list'],
  listWorkspaces: async () => [
    {
      id: 'ws-1',
      title: 'dsh-mobile',
      directory: 'C:/work/dsh-mobile',
      sessionIds: ['session-a', 'session-b'],
    },
    {
      id: 'ws-2',
      title: 'facturacion',
      directory: 'C:/work/facturacion',
      sessionIds: ['session-c'],
    },
    { id: 'ws-3', title: '', directory: 'C:/work/informes', sessionIds: [] },
  ],
  listSessions: async () => [
    {
      id: 'session-a',
      workspaceId: 'ws-1',
      title: 'Arreglar el despliegue de producción',
      updatedAt: now - 2 * 60 * 1000,
      seq: 412,
      agentAvailable: true,
      running: true,
      pendingQuestions: 0,
    },
    {
      id: 'session-b',
      workspaceId: 'ws-1',
      title: 'Revisar la migración de la base de datos',
      updatedAt: now - 14 * 60 * 1000,
      seq: 120,
      agentAvailable: true,
      running: false,
      pendingQuestions: 2,
    },
    {
      id: 'session-c',
      workspaceId: 'ws-2',
      title: 'Documentar la API de facturación',
      updatedAt: now - 3 * 60 * 60 * 1000,
      seq: 88,
      agentAvailable: true,
      running: false,
      pendingQuestions: 0,
    },
    {
      id: 'session-orphan',
      title: 'Sesión sin carpeta',
      updatedAt: now - 6 * 60 * 1000,
      seq: 90,
      agentAvailable: true,
      running: false,
      pendingQuestions: 0,
    },
    {
      id: 'session-lost-folder',
      title: 'Sesión de una carpeta borrada',
      workspaceId: 'ws-borrada',
      updatedAt: now - 7 * 60 * 1000,
      seq: 91,
      agentAvailable: true,
      running: false,
      pendingQuestions: 0,
    },
    {
      id: 'session-d',
      workspaceId: 'ws-2',
      title: 'Migrar los informes a la nueva plantilla',
      updatedAt: now - 11 * 24 * 60 * 60 * 1000,
      seq: 64,
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
      {
        seq: 4,
        at: now - 40_000,
        event: {
          kind: 'tool',
          name: 'write',
          summary: 'db/migrations/0042_conciliada.sql',
          status: 'ok',
        },
      },
      {
        seq: 5,
        at: now - 30_000,
        event: { kind: 'state', state: 'waiting' },
      },
    ],
    hasMore: false,
  }),
  subscribeSession: (_sessionId, { onEvent }) => {
    const primero = setTimeout(
      () => onEvent({ seq: 900, at: Date.now(), event: { kind: 'state', state: 'working' } }),
      2000,
    );
    const segundo = setTimeout(
      () => onEvent({ seq: 901, at: Date.now(), event: { kind: 'state', state: 'waiting' } }),
      30000,
    );

    return {
      stop: () => {
        clearTimeout(primero);
        clearTimeout(segundo);
      },
    };
  },
  sendReply: async () => ({ ok: true }),
  cancelRun: () => true,
  answerQuestion: () => ({ ok: true }),
});

console.log(`vista previa en http://127.0.0.1:${server.port}/`);
console.log(`token de vista previa: ${preview.token}`);
console.log('Ctrl+C para parar');
