import { service, type HostContext } from '../host-api.js';
import type { Workspace } from '@deepseekharness-mobile/protocol';

interface WorkspaceRow {
  workspaceId?: unknown;
  path?: unknown;
  title?: unknown;
  sessionIds?: unknown;
}

interface WorkspaceFeed {
  items?: unknown;
  value?: unknown;
  archivedSessionIds?: unknown;
}

export interface WorkspaceController {
  list?: () => unknown;
  follow?: (signal: AbortSignal) => AsyncIterable<unknown>;
  archiveSession?: (request: { sessionId: string; stopActivity?: boolean }) => Promise<unknown>;
  unarchiveSession?: (request: { sessionId: string }) => Promise<unknown>;
}

const FOLLOW_TIMEOUT_MS = 1500;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function toWorkspace(row: unknown): Workspace | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const source = row as WorkspaceRow;

  const id = text(source.workspaceId);
  const directory = text(source.path);
  if (!id || !directory) return undefined;

  return {
    id,
    title: typeof source.title === 'string' ? source.title : '',
    directory,
    sessionIds: sessionIds(source.sessionIds),
  };
}

function rowsFrom(node: unknown, depth = 0): unknown[] {
  if (depth > 3) return [];
  if (Array.isArray(node)) return node;
  if (typeof node !== 'object' || node === null) return [];

  const record = node as WorkspaceFeed;

  if (Array.isArray(record.items)) return record.items;

  if ('value' in record) return rowsFrom(record.value, depth + 1);

  return [];
}

export function rowsOf(payload: unknown): unknown[] {
  return rowsFrom(payload);
}

function archivedFrom(node: unknown, depth = 0): string[] {
  if (depth > 3 || typeof node !== 'object' || node === null) return [];
  const record = node as WorkspaceFeed;

  if (Array.isArray(record.archivedSessionIds)) {
    return record.archivedSessionIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  }

  return 'value' in record ? archivedFrom(record.value, depth + 1) : [];
}

export async function listArchivedSessions(ctx: HostContext): Promise<Set<string>> {
  const controller = service<WorkspaceController>(ctx, 'workspaceController');
  if (!controller) return new Set();

  try {
    if (typeof controller.list === 'function') {
      return new Set(archivedFrom(await controller.list()));
    }

    if (typeof controller.follow === 'function') {
      return new Set(archivedFrom(await firstFrame(controller.follow.bind(controller))));
    }
  } catch {}

  return new Set();
}

export function toWorkspaces(payload: unknown): Workspace[] {
  return rowsOf(payload)
    .map(toWorkspace)
    .filter((workspace): workspace is Workspace => workspace !== undefined);
}

async function firstFrame(
  follow: NonNullable<WorkspaceController['follow']>,
): Promise<unknown | undefined> {
  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), FOLLOW_TIMEOUT_MS);
  });

  const reading = (async (): Promise<unknown | undefined> => {
    for await (const frame of follow(controller.signal)) {
      const tipo = (frame as { type?: unknown }).type;
      if (tipo === 'baseline') return frame;
      if (rowsOf(frame).length > 0 || archivedFrom(frame).length > 0) return frame;
    }
    return undefined;
  })().catch(() => undefined);

  try {
    return await Promise.race([reading, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

export async function listWorkspaces(ctx: HostContext): Promise<Workspace[]> {
  const controller = service<WorkspaceController>(ctx, 'workspaceController');
  if (!controller) return [];

  try {
    if (typeof controller.list === 'function') {
      return toWorkspaces(await controller.list());
    }

    if (typeof controller.follow === 'function') {
      return toWorkspaces(await firstFrame(controller.follow.bind(controller)));
    }
  } catch {}

  return [];
}

export function hasWorkspaces(ctx: HostContext): boolean {
  try {
    const controller = service<WorkspaceController>(ctx, 'workspaceController');
    if (!controller) return false;
    return typeof controller.list === 'function' || typeof controller.follow === 'function';
  } catch {
    return false;
  }
}
