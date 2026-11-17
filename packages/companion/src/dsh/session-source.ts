import type {
  ModelSelection,
  SessionState as WireState,
  SessionSummary as WireSession,
  SessionUsage,
} from '@deepseekharness-mobile/protocol';
import {
  service,
  type HostContext,
  type ProjectionsService,
  type SessionsService,
} from '../host-api.js';
import { listArchivedSessions, listWorkspaces } from './workspaces.js';
import { selectionOf } from './models.js';

export interface SessionRecord {
  id: string;
  title: string;
  updatedAt: number;
  seq: number;
  agentAvailable: boolean;
  running: boolean;
  pendingQuestions: number;
  workspaceId?: string;
  model?: ModelSelection;
  archived?: boolean;
  usage?: SessionUsage;
}

interface ControllerSummary {
  sessionId?: string;
  updatedAt?: number;
  running?: boolean;
  blank?: boolean;
  agentAvailable?: boolean;
  projections?: {
    asOfSeq?: number;
    values?: Record<string, unknown>;
  };
}

interface SessionListController {
  list(
    request: { cursor?: string },
    signal: AbortSignal,
  ): Promise<{ items?: readonly ControllerSummary[] }>;
}

const MAX_SESSIONS = 200;

function countPending(snapshot: unknown): number {
  if (typeof snapshot !== 'object' || snapshot === null) return 0;
  const active = (snapshot as { active?: unknown }).active;
  return Array.isArray(active) ? active.length : 0;
}

function pendingFor(
  ctx: HostContext,
  sessionId: string,
  projections: ProjectionsService | undefined,
): number {
  if (!projections) return 0;
  const sessions = service<SessionsService>(ctx, 'sessions');
  const session = sessions?.get(sessionId);
  if (!session) return 0;

  try {
    return countPending(projections.snapshot(session).values['userQuestions']);
  } catch {
    return 0;
  }
}

function modelFor(item: ControllerSummary): ModelSelection | undefined {
  const snapshot = item.projections?.values?.['modelSelection'];
  if (typeof snapshot !== 'object' || snapshot === null) return undefined;
  const record = snapshot as Record<string, unknown>;

  return selectionOf(record['next']) ?? selectionOf(record['lastUsed']) ?? selectionOf(record);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function numOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function usageFor(
  ctx: HostContext,
  sessionId: string,
  projections: ProjectionsService | undefined,
): SessionUsage | undefined {
  if (!projections) return undefined;
  const sessions = service<SessionsService>(ctx, 'sessions');
  const session = sessions?.get(sessionId);
  if (!session) return undefined;

  let values: Record<string, unknown>;
  try {
    values = projections.snapshot(session).values;
  } catch {
    return undefined;
  }

  const pressure = recordOf(values['contextPressure']);
  const tokens = recordOf(values['tokenUsage']);
  const breakdown = recordOf(values['contextBreakdown']);
  const stats = recordOf(values['sessionStats']);
  const usage: SessionUsage = {};

  if (pressure) {
    const contextPressure: NonNullable<SessionUsage['contextPressure']> = {};
    const pressureTokens = numOr(pressure['pressureTokens']);
    const projectedTokens = numOr(pressure['projectedTokens']);
    const contextWindow = numOr(pressure['contextWindow']);
    if (pressureTokens !== undefined) contextPressure.pressureTokens = pressureTokens;
    if (projectedTokens !== undefined) contextPressure.projectedTokens = projectedTokens;
    if (contextWindow !== undefined) contextPressure.contextWindow = contextWindow;
    if (Object.keys(contextPressure).length > 0) usage.contextPressure = contextPressure;
  }

  if (tokens) {
    const uncachedInputTokens = numOr(tokens['uncachedInputTokens']);
    const outputTokens = numOr(tokens['outputTokens']);
    const cacheReadTokens = numOr(tokens['cacheReadTokens']);
    const cacheWriteTokens = numOr(tokens['cacheWriteTokens']);
    if (
      uncachedInputTokens !== undefined &&
      outputTokens !== undefined &&
      cacheReadTokens !== undefined &&
      cacheWriteTokens !== undefined
    ) {
      usage.tokens = { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
    }
  }

  if (breakdown) {
    const systemTokens = numOr(breakdown['systemTokens']);
    const toolsTokens = numOr(breakdown['toolsTokens']);
    const messageTokens = numOr(breakdown['messageTokens']);
    if (systemTokens !== undefined && toolsTokens !== undefined && messageTokens !== undefined) {
      usage.breakdown = { systemTokens, toolsTokens, messageTokens };
    }
  }

  if (stats) {
    const turns = numOr(stats['turns']);
    const steps = numOr(stats['steps']);
    const llmMs = numOr(stats['llmMs']);
    const toolMs = numOr(stats['toolMs']);
    const ttftMs = numOr(stats['ttftMs']);
    const ttftSteps = numOr(stats['ttftSteps']);
    const decodeMs = numOr(stats['decodeMs']);
    const decodeTokens = numOr(stats['decodeTokens']);
    if (
      turns !== undefined &&
      steps !== undefined &&
      llmMs !== undefined &&
      toolMs !== undefined &&
      ttftMs !== undefined &&
      ttftSteps !== undefined &&
      decodeMs !== undefined &&
      decodeTokens !== undefined
    ) {
      usage.stats = { turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens };
    }
  }

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function wireState(record: SessionRecord): WireState {
  if (record.pendingQuestions > 0) return 'waiting';
  if (record.running) return 'working';
  return 'idle';
}

export async function listSessions(
  ctx: HostContext,
  options: { includeArchived?: boolean } = {},
): Promise<SessionRecord[]> {
  const controller = service<SessionListController>(ctx, 'sessionController');
  if (!controller || typeof controller.list !== 'function') return [];

  const projections = service<ProjectionsService>(ctx, 'sessionProjections');

  let items: readonly ControllerSummary[];
  try {
    const result = await controller.list({}, new AbortController().signal);
    items = result?.items ?? [];
  } catch {
    return [];
  }

  const records: SessionRecord[] = items
    .slice(0, MAX_SESSIONS)
    .map((item) => {
      const id = typeof item.sessionId === 'string' ? item.sessionId : '';
      const titleValue = item.projections?.values?.['title'];
      const pendingQuestions = id ? pendingFor(ctx, id, projections) : 0;
      const model = id ? modelFor(item) : undefined;
      const usage = id ? usageFor(ctx, id, projections) : undefined;

      return {
        id,
        title: typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : 'Untitled',
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        seq: typeof item.projections?.asOfSeq === 'number' ? item.projections.asOfSeq : 0,
        agentAvailable: item.agentAvailable === true,
        running: item.running === true,
        pendingQuestions,
        ...(model ? { model } : {}),
        ...(usage ? { usage } : {}),
      };
    })
    .filter((record) => record.id !== '');

  try {
    const workspaces = await listWorkspaces(ctx);
    const folderOf = new Map<string, string>();
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) folderOf.set(sessionId, workspace.id);
    }
    for (const record of records) {
      const folder = folderOf.get(record.id);
      if (folder) record.workspaceId = folder;
    }
  } catch {}

  const archived = await listArchivedSessions(ctx).catch(() => new Set<string>());

  const visible =
    options.includeArchived === true
      ? records.map((record) => (archived.has(record.id) ? { ...record, archived: true } : record))
      : records.filter((record) => !archived.has(record.id));

  return visible.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function toWireSession(record: SessionRecord): WireSession {
  return {
    id: record.id,
    title: record.title,
    state: wireState(record),
    updatedAt: record.updatedAt,
    seq: record.seq,
    pendingQuestions: record.pendingQuestions,
    ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(record.archived ? { archived: true } : {}),
    ...(record.usage ? { usage: record.usage } : {}),
  };
}
