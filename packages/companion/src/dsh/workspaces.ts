/**
 * Folders of the desktop.
 *
 * A Workspace in DeepSeek Harness is a registered directory with a title and a list
 * of sessions. The shape here is the host's real projection
 * (`@deepseek-ai/dsh-api-workspace-controller/lib/types/feed.js`):
 *
 *     { workspaceId, path, title, sessionIds, createdAt, updatedAt }
 *     baseline: { items, archivedSessionIds, pinnedSessionIds }
 *
 * The service is not declared in `inject`, so it comes through the reflection proxy.
 * **Nothing here can be assumed present**: a host without workspaces must degrade to
 * a flat session list, not to an error.
 */
import { service, type HostContext } from '../host-api.js';
import type { Workspace } from '@dsh-mobile/protocol';

/** A row of the host projection, as it really arrives. */
interface WorkspaceRow {
  workspaceId?: unknown;
  path?: unknown;
  title?: unknown;
  sessionIds?: unknown;
}

/** The `baseline` frame, or an object that carries the rows under `items`. */
interface WorkspaceFeed {
  items?: unknown;
}

/** The Host service. Only the parts we use, and all optional. */
export interface WorkspaceController {
  /** A one-shot list, when the host offers it. */
  list?: () => unknown;
  /** A stream whose first frame is a complete baseline. */
  follow?: (signal: AbortSignal) => AsyncIterable<unknown>;
}

/** How long to wait for a baseline before giving up. Never hang the command. */
const FOLLOW_TIMEOUT_MS = 1500;

/** Reads a string field, or `undefined` if it is missing or empty. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads the session ids, dropping anything that is not a non-empty string. */
function sessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Turns one projection row into the contract shape.
 *
 * The fields are **renamed** (`workspaceId` → `id`, `path` → `directory`) because the
 * protocol should not leak the host's vocabulary. A row without an id or a path is
 * dropped: it cannot be opened and it cannot be shown.
 */
export function toWorkspace(row: unknown): Workspace | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const source = row as WorkspaceRow;

  const id = text(source.workspaceId);
  const directory = text(source.path);
  if (!id || !directory) return undefined;

  return {
    id,
    // An empty title is legitimate: the desktop derives a display name.
    title: typeof source.title === 'string' ? source.title : '',
    directory,
    sessionIds: sessionIds(source.sessionIds),
  };
}

/** Extracts the rows from whatever wrapper the host used. */
export function rowsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload === 'object' && payload !== null) {
    const items = (payload as WorkspaceFeed).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

/** Maps a payload of rows, dropping the unusable ones. */
export function toWorkspaces(payload: unknown): Workspace[] {
  return rowsOf(payload)
    .map(toWorkspace)
    .filter((workspace): workspace is Workspace => workspace !== undefined);
}

/** Takes the first frame of `follow`, or `undefined` if it does not arrive in time. */
async function firstFrame(
  follow: NonNullable<WorkspaceController['follow']>,
): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FOLLOW_TIMEOUT_MS);

  try {
    for await (const frame of follow(controller.signal)) return frame;
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Reads the folders, or an empty list.
 *
 * Three strategies, in order of cheapness:
 *  1. `list()` if the host has it — one call, no stream.
 *  2. Otherwise the first `baseline` of `follow()`, with a timeout.
 *  3. Neither: no folders, which the caller renders as a flat list.
 *
 * It never throws: a workspace problem must not take down the session list.
 */
export async function listWorkspaces(ctx: HostContext): Promise<Workspace[]> {
  const controller = service<WorkspaceController>(ctx, 'workspaceController');
  if (!controller) return [];

  try {
    if (typeof controller.list === 'function') {
      return toWorkspaces(controller.list());
    }

    if (typeof controller.follow === 'function') {
      return toWorkspaces(await firstFrame(controller.follow.bind(controller)));
    }
  } catch {
    // A host that answers with something unexpected is a host without folders.
  }

  return [];
}

/** `true` if this host can answer `workspace.list`. */
export function hasWorkspaces(ctx: HostContext): boolean {
  const controller = service<WorkspaceController>(ctx, 'workspaceController');
  if (!controller) return false;
  return typeof controller.list === 'function' || typeof controller.follow === 'function';
}
