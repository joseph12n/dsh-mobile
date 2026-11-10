import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { listSessions, toWireSession } from './session-source.js';

/**
 * El adaptador no reimplementa la lista: delega en `sessionController`, que es lo
 * que ve el escritorio. Estas pruebas fijan esa traducción.
 */

interface SummaryOverrides {
  sessionId: string;
  updatedAt?: number;
  running?: boolean;
  agentAvailable?: boolean;
  title?: string | null;
  asOfSeq?: number;
}

function summary(overrides: SummaryOverrides) {
  return {
    sessionId: overrides.sessionId,
    updatedAt: overrides.updatedAt ?? 1_000,
    running: overrides.running ?? false,
    agentAvailable: overrides.agentAvailable ?? true,
    projections: {
      asOfSeq: overrides.asOfSeq ?? 42,
      values: { title: overrides.title === undefined ? 'Una sesión' : overrides.title },
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
    expect(records[0]?.title).toBe('Sin título');
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
});
