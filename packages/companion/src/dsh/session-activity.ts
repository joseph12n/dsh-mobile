import type {
  ActivityGoal,
  ActivitySubagent,
  ActivityTodo,
  SessionActivity,
} from '@dsh-mobile/protocol';
import {
  service,
  type HostContext,
  type HostSession,
  type ProjectionsService,
  type SessionsService,
  type SubagentsService,
} from '../host-api.js';

const MAX_SUBAGENTS = 20;
const MAX_TODOS = 8;

export function activityAvailable(ctx: HostContext): boolean {
  return (
    Boolean(service<ProjectionsService>(ctx, 'sessionProjections')) &&
    Boolean(service<SessionsService>(ctx, 'sessions'))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function goalOf(value: unknown): ActivityGoal | undefined {
  if (!isRecord(value)) return undefined;

  const goal = isRecord(value['goal']) ? value['goal'] : value;
  const objective = typeof goal['objective'] === 'string' ? goal['objective'] : undefined;
  const phase = typeof goal['phase'] === 'string' ? goal['phase'] : undefined;
  if (!objective || !phase) return undefined;

  const roundsStarted =
    typeof value['roundsStarted'] === 'number' && value['roundsStarted'] >= 0
      ? value['roundsStarted']
      : 0;
  const maxRounds =
    typeof goal['maxGoalRounds'] === 'number' && goal['maxGoalRounds'] > 0
      ? goal['maxGoalRounds']
      : undefined;

  return { objective, phase, roundsStarted, ...(maxRounds ? { maxRounds } : {}) };
}

function todosOf(value: unknown): SessionActivity['todos'] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const items: ActivityTodo[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw['content'] !== 'string') continue;
    const status = raw['status'];
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') continue;
    items.push({ content: raw['content'], status });
  }
  if (items.length === 0) return undefined;

  return {
    open: items.filter((item) => item.status !== 'completed').length,
    total: items.length,
    items: items.slice(0, MAX_TODOS),
  };
}

function planActiveOf(value: unknown): boolean {
  return isRecord(value) && value['active'] === true;
}

async function subagentsOf(ctx: HostContext, sessionId: string): Promise<ActivitySubagent[]> {
  const subagents = service<SubagentsService>(ctx, 'subagents');
  if (!subagents || typeof subagents.listDescendants !== 'function') return [];

  try {
    const entries = await subagents.listDescendants(sessionId, new AbortController().signal);
    const rows = entries
      .filter((entry) => entry.kind === 'child')
      .map((entry) => ({
        id: entry.id,
        ...(typeof entry.label === 'string' && entry.label ? { label: entry.label } : {}),
        activity: entry.activity === 'running' ? ('running' as const) : ('inactive' as const),
        depth: typeof entry.depth === 'number' && entry.depth > 0 ? entry.depth : 1,
        ...(entry.hasChildren !== undefined ? { hasChildren: entry.hasChildren } : {}),
      }));

    rows.sort((left, right) => {
      if (left.activity !== right.activity) return left.activity === 'running' ? -1 : 1;
      return left.depth - right.depth;
    });

    return rows.slice(0, MAX_SUBAGENTS);
  } catch {
    return [];
  }
}

function snapshotOf(
  projections: ProjectionsService,
  session: HostSession,
): Record<string, unknown> | undefined {
  try {
    return projections.snapshot(session).values;
  } catch {
    return undefined;
  }
}

export async function readSessionActivity(
  ctx: HostContext,
  sessionId: string,
): Promise<SessionActivity> {
  const projections = service<ProjectionsService>(ctx, 'sessionProjections');
  const sessions = service<SessionsService>(ctx, 'sessions');
  const session = sessions?.get(sessionId);
  const values = session && projections ? snapshotOf(projections, session) : undefined;

  const goal = goalOf(values?.['goal']);
  const todos = todosOf(values?.['todos']);
  const planActive = planActiveOf(values?.['plan']);
  const subagents = await subagentsOf(ctx, sessionId);

  return {
    ...(goal ? { goal } : {}),
    subagents,
    ...(todos ? { todos } : {}),
    ...(planActive ? { planActive } : {}),
  };
}
