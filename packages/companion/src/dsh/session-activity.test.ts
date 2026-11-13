import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { activityAvailable, readSessionActivity } from './session-activity.js';

interface FakeOptions {
  values?: Record<string, unknown>;
  noSession?: boolean;
  noProjections?: boolean;
  snapshotThrows?: boolean;
  subagents?: unknown[];
  noSubagents?: boolean;
  subagentsThrow?: boolean;
}

function context(options: FakeOptions = {}): HostContext {
  const sessions = options.noSession
    ? undefined
    : { get: (id: string) => ({ id }), list: () => [] };

  const sessionProjections = options.noProjections
    ? undefined
    : {
        snapshot: () => {
          if (options.snapshotThrows) throw new Error('roto');
          return { asOfSeq: 1, values: options.values ?? {} };
        },
      };

  const subagents = options.noSubagents
    ? undefined
    : {
        listDescendants: async () => {
          if (options.subagentsThrow) throw new Error('roto');
          return options.subagents ?? [];
        },
      };

  return { sessions, sessionProjections, subagents } as unknown as HostContext;
}

const goalView = {
  goal: { objective: 'Mejorar el chat', phase: 'active', maxGoalRounds: 256 },
  roundsStarted: 6,
};

describe('readSessionActivity', () => {
  it('traduce meta, tareas, plan y subagentes', async () => {
    const ctx = context({
      values: {
        goal: goalView,
        todos: [
          { content: 'Pintar la paleta', status: 'completed' },
          { content: 'Probar el panel', status: 'in_progress' },
          { content: 'Cerrar el PR', status: 'pending' },
        ],
        plan: { active: true },
      },
      subagents: [
        { id: 'a', kind: 'child', label: 'Investigador', activity: 'inactive', depth: 2 },
        { id: 'b', kind: 'child', label: 'Diseño', activity: 'running', depth: 1 },
        { id: 'd', kind: 'diagnostic', reason: 'unavailable' },
      ],
    });

    await expect(readSessionActivity(ctx, 'session-1')).resolves.toEqual({
      goal: {
        objective: 'Mejorar el chat',
        phase: 'active',
        roundsStarted: 6,
        maxRounds: 256,
      },
      subagents: [
        { id: 'b', label: 'Diseño', activity: 'running', depth: 1 },
        { id: 'a', label: 'Investigador', activity: 'inactive', depth: 2 },
      ],
      todos: {
        open: 2,
        total: 3,
        items: [
          { content: 'Pintar la paleta', status: 'completed' },
          { content: 'Probar el panel', status: 'in_progress' },
          { content: 'Cerrar el PR', status: 'pending' },
        ],
      },
      planActive: true,
    });
  });

  it('devuelve una actividad vacía sin sesión o sin proyecciones', async () => {
    await expect(readSessionActivity(context({ noSession: true }), 'session-1')).resolves.toEqual({
      subagents: [],
    });
    await expect(
      readSessionActivity(context({ noProjections: true }), 'session-1'),
    ).resolves.toEqual({ subagents: [] });
  });

  it('tolera una instantánea rota y un servicio de subagentes que falla', async () => {
    const ctx = context({ snapshotThrows: true, subagentsThrow: true });
    await expect(readSessionActivity(ctx, 'session-1')).resolves.toEqual({ subagents: [] });
  });

  it('ignora metas y tareas mal formadas', async () => {
    const ctx = context({
      values: {
        goal: { goal: { phase: 'active' }, roundsStarted: 2 },
        todos: [{ content: 7, status: 'pending' }, { content: 'sin estado' }],
      },
    });
    await expect(readSessionActivity(ctx, 'session-1')).resolves.toEqual({ subagents: [] });
  });

  it('recorta subagentes y tareas sin perder los totales', async () => {
    const subagents = Array.from({ length: 25 }, (_, index) => ({
      id: `child-${index}`,
      kind: 'child',
      activity: 'inactive',
      depth: 1,
    }));
    const todos = Array.from({ length: 10 }, (_, index) => ({
      content: `tarea ${index}`,
      status: 'pending',
    }));

    const activity = await readSessionActivity(
      context({ values: { todos }, subagents }),
      'session-1',
    );

    expect(activity.subagents).toHaveLength(20);
    expect(activity.todos).toMatchObject({ open: 10, total: 10 });
    expect(activity.todos?.items).toHaveLength(8);
  });
});

describe('activityAvailable', () => {
  it('exige sesiones y proyecciones', () => {
    expect(activityAvailable(context())).toBe(true);
    expect(activityAvailable(context({ noSession: true }))).toBe(false);
    expect(activityAvailable(context({ noProjections: true }))).toBe(false);
  });
});
