import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { listSessions, toWireSession } from './session-source.js';

interface SummaryOverrides {
  sessionId: string;
  updatedAt?: number;
  running?: boolean;
  agentAvailable?: boolean;
  title?: string | null;
  asOfSeq?: number;
  values?: Record<string, unknown>;
}

function summary(overrides: SummaryOverrides) {
  return {
    sessionId: overrides.sessionId,
    updatedAt: overrides.updatedAt ?? 1_000,
    running: overrides.running ?? false,
    agentAvailable: overrides.agentAvailable ?? true,
    projections: {
      asOfSeq: overrides.asOfSeq ?? 42,
      values: {
        title: overrides.title === undefined ? 'Una sesión' : overrides.title,
        ...overrides.values,
      },
    },
  };
}

function ctxWith(summaries: ReturnType<typeof summary>[], pending = 0): HostContext {
  return {
    sessionController: {
      list: () => Promise.resolve({ items: summaries }),
    },
    sessions: {
      list: () => summaries.map((item) => ({ id: item.sessionId })),
      get: (id: string) => (summaries.some((item) => item.sessionId === id) ? { id } : undefined),
    },
    sessionProjections: {
      snapshot: () => ({
        asOfSeq: 42,
        values: {
          userQuestions: { active: Array.from({ length: pending }), settled: [] },
        },
      }),
    },
  };
}

describe('listado de sesiones', () => {
  it('traduce los campos del controlador', async () => {
    const records = await listSessions(ctxWith([summary({ sessionId: 's1', title: 'Mi sesión' })]));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 's1', title: 'Mi sesión', seq: 42 });
  });

  it('ordena por actividad, lo más reciente primero', async () => {
    const records = await listSessions(
      ctxWith([
        summary({ sessionId: 'vieja', updatedAt: 100 }),
        summary({ sessionId: 'nueva', updatedAt: 900 }),
      ]),
    );
    expect(records.map((record) => record.id)).toEqual(['nueva', 'vieja']);
  });

  it('pone un título legible cuando la proyección viene vacía', async () => {
    const records = await listSessions(ctxWith([summary({ sessionId: 's1', title: null })]));
    expect(records[0]?.title).toBe('Untitled');
  });

  it('cuenta las preguntas pendientes de la proyección', async () => {
    const records = await listSessions(ctxWith([summary({ sessionId: 's1' })], 2));
    expect(records[0]?.pendingQuestions).toBe(2);
    expect(toWireSession(records[0]!).state).toBe('waiting');
  });

  it('marca working cuando hay un turno en curso', async () => {
    const records = await listSessions(ctxWith([summary({ sessionId: 's1', running: true })]));
    expect(toWireSession(records[0]!).state).toBe('working');
  });

  it('marca idle cuando no pasa nada', async () => {
    const records = await listSessions(ctxWith([summary({ sessionId: 's1' })]));
    expect(toWireSession(records[0]!).state).toBe('idle');
  });

  it('devuelve lista vacía si el host no expone sessionController', async () => {
    expect(await listSessions({})).toEqual([]);
  });

  it('devuelve lista vacía si el controlador falla', async () => {
    const ctx: HostContext = {
      sessionController: {
        list: () => Promise.reject(new Error('boom')),
      },
    };
    expect(await listSessions(ctx)).toEqual([]);
  });

  it('descarta entradas sin identificador', async () => {
    const records = await listSessions(ctxWith([summary({ sessionId: '' })]));
    expect(records).toEqual([]);
  });

  it('sobrevive a una proyección de preguntas rota', async () => {
    const ctx: HostContext = {
      sessionController: { list: () => Promise.resolve({ items: [summary({ sessionId: 's1' })] }) },
      sessions: { list: () => [], get: () => ({ id: 's1' }) },
      sessionProjections: {
        snapshot: () => {
          throw new Error('sin proyección');
        },
      },
    };
    const records = await listSessions(ctx);
    expect(records[0]?.pendingQuestions).toBe(0);
  });

  it('quita las sesiones archivadas: archivar desde el móvil tiene que notarse', async () => {
    const ctx: HostContext = {
      sessionController: {
        list: () =>
          Promise.resolve({
            items: [summary({ sessionId: 's1' }), summary({ sessionId: 's2' })],
          }),
      },
      workspaceController: {
        list: () => Promise.resolve({ items: [], archivedSessionIds: ['s1'] }),
      },
    };

    const records = await listSessions(ctx);
    expect(records.map((record) => record.id)).toEqual(['s2']);
  });

  it('las marca en vez de quitarlas cuando la lista las pide', async () => {
    const ctx: HostContext = {
      sessionController: {
        list: () =>
          Promise.resolve({
            items: [summary({ sessionId: 's1' }), summary({ sessionId: 's2' })],
          }),
      },
      workspaceController: {
        list: () => Promise.resolve({ items: [], archivedSessionIds: ['s1'] }),
      },
    };

    const records = await listSessions(ctx, { includeArchived: true });
    expect(records.map((record) => [record.id, record.archived ?? false])).toEqual([
      ['s1', true],
      ['s2', false],
    ]);
    expect(toWireSession(records[0]!).archived).toBe(true);
    expect('archived' in toWireSession(records[1]!)).toBe(false);
  });

  it('la copia marcada conserva el resto de los campos', async () => {
    const ctx: HostContext = {
      sessionController: {
        list: () =>
          Promise.resolve({
            items: [
              summary({
                sessionId: 's1',
                title: 'Archivada',
                asOfSeq: 77,
                values: {
                  modelSelection: {
                    next: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
                  },
                },
              }),
            ],
          }),
      },
      workspaceController: {
        list: () =>
          Promise.resolve({
            items: [{ workspaceId: 'ws-1', path: '/work', title: 'w', sessionIds: ['s1'] }],
            archivedSessionIds: ['s1'],
          }),
      },
    };

    const records = await listSessions(ctx, { includeArchived: true });
    const wire = toWireSession(records[0]!);
    expect(wire).toMatchObject({
      id: 's1',
      title: 'Archivada',
      seq: 77,
      workspaceId: 'ws-1',
      archived: true,
      model: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
    });
  });

  it('lee el modelo de la proyección, prefiriendo el que se aplicará', async () => {
    const records = await listSessions(
      ctxWith([
        summary({
          sessionId: 's1',
          values: {
            modelSelection: {
              lastUsed: { provider: 'deepseek', model: 'chat' },
              next: { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' },
            },
          },
        }),
      ]),
    );

    expect(toWireSession(records[0]!).model).toEqual({
      provider: 'deepseek',
      model: 'reasoner',
      reasoningEffort: 'high',
    });
  });

  it('omite el modelo cuando el host no lo proyecta', async () => {
    const records = await listSessions(ctxWith([summary({ sessionId: 's1' })]));
    expect('model' in toWireSession(records[0]!)).toBe(false);
  });

  it('omite una proyección de modelo malformada en vez de romper la lista', async () => {
    const records = await listSessions(
      ctxWith([
        summary({ sessionId: 's1', values: { modelSelection: { next: { provider: 42 } } } }),
        summary({ sessionId: 's2', values: { modelSelection: { next: null, lastUsed: null } } }),
        summary({ sessionId: 's3', values: { modelSelection: 'nada' } }),
      ]),
    );

    expect(records).toHaveLength(3);
    for (const record of records) expect('model' in toWireSession(record)).toBe(false);
  });
});
