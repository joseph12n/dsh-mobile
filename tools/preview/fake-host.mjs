import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] ?? 6799);
const mode = process.argv[3] ?? 'ok';
const now = Date.now();

const host = {
  id: 'fake-host',
  name: 'Harness de diseño',
  version: '0',
  platform: 'test',
  capabilities: [
    'workspace.list',
    'session.create',
    'workspace.archive',
    'workspace.unarchive',
    'model.select',
    'session.history',
    'reply.send',
    'run.cancel',
    'question.answer',
  ],
};

const device = {
  id: 'device-demo',
  name: 'Edge de diseño',
  createdAt: now - 86_400_000,
  lastSeenAt: now,
};

const workspaces = [
  {
    id: 'ws-app',
    title: 'dsh-mobile',
    directory: 'C:\\work\\dsh-mobile',
    sessionIds: ['session-demo-1', 'session-demo-3'],
  },
  {
    id: 'ws-api',
    title: 'api',
    directory: 'C:\\work\\apps\\api',
    sessionIds: ['session-demo-2', 'session-demo-4'],
  },
  {
    id: 'ws-web',
    title: 'web',
    directory: 'C:\\work\\apps\\web',
    sessionIds: ['session-demo-5', 'session-demo-6'],
  },
  {
    id: 'ws-lab',
    title: 'laboratorio',
    directory: 'C:\\work\\laboratorio',
    sessionIds: [],
  },
];

const sessions = [
  {
    id: 'session-demo-1',
    title: 'Restaurar la caché del escritorio',
    state: 'waiting',
    updatedAt: now - 60_000,
    seq: 3,
    pendingQuestions: 1,
    workspaceId: 'ws-app',
  },
  {
    id: 'session-demo-2',
    title: 'Revisar el contrato de eventos',
    state: 'done',
    updatedAt: now - 3_600_000,
    seq: 4,
    pendingQuestions: 0,
    model: { provider: 'demo', model: 'big', reasoningEffort: 'high' },
    workspaceId: 'ws-api',
  },
  {
    id: 'session-demo-3',
    title: 'Emparejamiento desde el QR del tailnet',
    state: 'working',
    updatedAt: now - 620_000,
    seq: 12,
    pendingQuestions: 0,
    model: { provider: 'demo', model: 'small' },
    workspaceId: 'ws-app',
  },
  {
    id: 'session-demo-4',
    title: 'Ajustar el límite de marcos por minuto',
    state: 'idle',
    updatedAt: now - 7_200_000,
    seq: 9,
    pendingQuestions: 0,
    workspaceId: 'ws-api',
  },
  {
    id: 'session-demo-5',
    title: 'Lista de sesiones con estados',
    state: 'idle',
    updatedAt: now - 900_000,
    seq: 21,
    pendingQuestions: 0,
    model: { provider: 'demo', model: 'big' },
    workspaceId: 'ws-web',
  },
  {
    id: 'session-demo-6',
    title: 'Cabecera viva y transcripción por turnos',
    state: 'error',
    updatedAt: now - 26 * 3_600_000,
    seq: 33,
    pendingQuestions: 0,
    archived: true,
    workspaceId: 'ws-web',
  },
];

const batch = {
  callId: 'call-demo-1',
  sessionId: 'session-demo-1',
  state: 'open',
  createdAt: now,
  items: [
    {
      id: 'q1',
      header: 'Permiso',
      text: 'Bash quiere ejecutar `rm -rf dist` antes de compilar. ¿Lo permite?',
      detail: 'rm -rf dist\npnpm build',
      options: [
        { label: 'Permitir', description: 'Borra dist y compila de nuevo.' },
        { label: 'Rechazar', description: 'No se toca nada.' },
      ],
      multiSelect: false,
      allowCustom: true,
    },
  ],
};

const laterBatch = {
  callId: 'call-demo-2',
  sessionId: 'session-demo-1',
  state: 'open',
  createdAt: now + 1000,
  items: [
    {
      id: 'q2',
      header: 'Prueba en vivo',
      text: '¿Aparece esta pregunta sin tocar la app?',
      options: [{ label: 'Sí', description: 'El móvil la recibió solo.' }, { label: 'No' }],
      multiSelect: false,
      allowCustom: false,
    },
  ],
};

let pendingQuestion = batch;

const catalog = {
  default: { provider: 'demo', model: 'big', reasoningEffort: 'high' },
  groups: [
    {
      id: 'demo',
      name: 'Demo',
      models: [
        {
          id: 'big',
          name: 'Demo Big',
          description: 'El modelo grande',
          reasoningEfforts: [
            { id: 'low', name: 'Bajo' },
            { id: 'medium', name: 'Medio' },
            { id: 'high', name: 'Alto' },
          ],
          defaultReasoningEffort: 'high',
        },
        { id: 'small', name: 'Demo Small', description: 'Rápido y barato' },
      ],
    },
    {
      id: 'demo-otro',
      name: 'Otro proveedor',
      models: [
        {
          id: 'flash',
          name: 'Demo Flash',
          reasoningEfforts: [{ id: 'auto', name: 'Automático' }],
          defaultReasoningEffort: 'auto',
        },
      ],
    },
  ],
  failures: [],
};

const topics = [
  'Revisa el contrato de eventos y dime si falta algo.',
  'Falta `session.state` en la unión de mensajes del cliente: el host lo declara pero la PWA no lo escucha, así que el indicador de estado solo cambia con eventos de transcripción.',
  'Lo añado y lo dejo cubierto con una prueba.',
  'Comprueba que el sondeo de servicios resuelve `sessionController`.',
  'Resuelve: `ctx.get("sessionController")` devuelve el servicio y `prompt` es una función.',
  'Ahora quiero que el modelo se pueda cambiar sin subir hasta arriba.',
  'La fila del modelo tiene que quedarse fija bajo la cabecera, fuera del scroll de la conversación.',
  'Con el chat largo, el botón Atrás del móvil tiene que volver a la lista de sesiones, no salir de la app.',
  'El historial del navegador se resuelve con `pushState` al abrir y `popstate` al volver.',
  'Verifícalo en el navegador real, no solo en las pruebas.',
  'Hecho: la conversación conserva su sitio y la lista aparece al volver.',
];

const history = [];
for (let index = 0; index < 80; index += 1) {
  const text = topics[index % topics.length];
  history.push({
    seq: index * 2 + 1,
    at: now - (80 - index) * 45_000,
    event: { kind: 'message', role: 'user', text },
  });
  history.push({
    seq: index * 2 + 2,
    at: now - (80 - index) * 44_000,
    event: {
      kind: 'message',
      role: 'assistant',
      text: `${text}\n\nPaso ${index + 1}: miro el código, ajusto la prueba y lo dejo listo. Sin atajos.`,
      ...(index < 2
        ? {
            reasoning:
              `El usuario pide: "${text}".\n\nReviso el estado del proyecto, descarto la opción barata y elijo la que no deja deuda. ` +
              'Compruebo el borde antes de escribir y dejo la prueba roja primero.',
          }
        : {}),
    },
  });
  if (index % 9 === 4) {
    history.push({
      seq: index * 2 + 3,
      at: now - (80 - index) * 43_000,
      event: { kind: 'tool', name: 'bash', summary: 'pnpm test', status: 'ok' },
    });
  }
}

let nextId = 7;

const wss = new WebSocketServer({ port });

wss.on('connection', (socket) => {
  const send = (body) => socket.send(JSON.stringify({ v: 1, at: Date.now(), ...body }));

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const reply = (body) => send({ id: message.id, ...body });

    if (message.type === 'hello') {
      reply({ type: 'hello.ok', host, ...(message.deviceToken ? { device } : {}) });
      return;
    }

    if (message.type === 'ping') {
      reply({ type: 'pong' });
      return;
    }

    if (message.type === 'pair.redeem') {
      reply({ type: 'pair.ok', deviceToken: 'demo-token', device, host });
      return;
    }

    if (message.type === 'sessions.list') {
      const visible = sessions.filter((session) => !session.archived || message.includeArchived);
      reply({ type: 'sessions.ok', sessions: visible });
      if (pendingQuestion) {
        send({ id: `q-${Date.now()}`, type: 'question.pending', question: pendingQuestion });
      }
      return;
    }

    if (message.type === 'workspace.list') {
      reply({ type: 'workspace.ok', workspaces });
      return;
    }

    if (message.type === 'models.list') {
      if (mode === 'error') {
        reply({ type: 'error', code: 'internal', message: 'catalog unavailable' });
        return;
      }
      if (mode === 'delay') {
        setTimeout(() => reply({ type: 'models.ok', catalog }), 8000);
        return;
      }
      reply({ type: 'models.ok', catalog });
      return;
    }

    if (message.type === 'model.select') {
      reply({
        type: 'model.selected',
        sessionId: message.sessionId,
        selection: {
          provider: message.provider,
          model: message.model,
          ...(message.reasoningEffort ? { reasoningEffort: message.reasoningEffort } : {}),
        },
      });
      return;
    }

    if (message.type === 'session.history') {
      reply({ type: 'history.ok', sessionId: message.sessionId, entries: history, hasMore: false });
      return;
    }

    if (message.type === 'session.subscribe') {
      reply({ type: 'session.ok', sessionId: message.sessionId, seq: 160 });
      return;
    }

    if (message.type === 'reply.send') {
      if (mode === 'reply-error') {
        reply({ type: 'error', code: 'internal', message: 'el host no pudo enviar el mensaje' });
        return;
      }
      reply({ type: 'reply.ok', sessionId: message.sessionId, seq: 161 });
      return;
    }

    if (message.type === 'run.cancel') {
      reply({ type: 'run.ok', sessionId: message.sessionId, state: 'idle' });
      return;
    }

    if (message.type === 'question.answer') {
      reply({ type: 'answer.ok', callId: message.callId });

      if (pendingQuestion && message.callId === pendingQuestion.callId) {
        pendingQuestion = undefined;
        const answered = sessions.find((session) => session.id === message.sessionId);
        if (answered) {
          answered.pendingQuestions = 0;
          answered.state = 'idle';
        }

        send({
          id: `s-${Date.now()}`,
          type: 'question.settled',
          callId: message.callId,
          sessionId: message.sessionId,
        });

        if (message.callId === batch.callId) {
          setTimeout(() => {
            pendingQuestion = laterBatch;
            if (answered) {
              answered.pendingQuestions = 1;
              answered.state = 'waiting';
            }
          }, 3000);
        }
      }
      return;
    }
    if (message.type === 'session.create') {
      const workspace = workspaces.find((item) => item.id === message.workspaceId);
      const sessionId = `session-demo-${nextId}`;
      nextId += 1;
      sessions.unshift({
        id: sessionId,
        title: 'Nueva sesión',
        state: 'idle',
        updatedAt: Date.now(),
        seq: 0,
        pendingQuestions: 0,
        ...(workspace ? { workspaceId: workspace.id } : {}),
      });
      if (workspace) workspace.sessionIds.push(sessionId);
      reply({ type: 'session.created', sessionId });
      return;
    }

    if (message.type === 'workspace.archive') {
      const session = sessions.find((item) => item.id === message.sessionId);
      if (!session) {
        reply({ type: 'error', code: 'not-found', message: 'unknown session' });
        return;
      }
      session.archived = true;
      reply({ type: 'workspace.archived', sessionId: message.sessionId });
      return;
    }

    if (message.type === 'workspace.unarchive') {
      const session = sessions.find((item) => item.id === message.sessionId);
      if (session) delete session.archived;
      reply({ type: 'workspace.unarchived', sessionId: message.sessionId });
      return;
    }

    reply({ type: 'error', code: 'bad-request', message: 'fake host: unsupported' });
  });
});

console.log(`fake host on ws://127.0.0.1:${port}`);
