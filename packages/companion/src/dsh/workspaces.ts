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

/** A frame or payload that carries the rows, under `items` or under `value`. */
interface WorkspaceFeed {
  items?: unknown;
  value?: unknown;
  archivedSessionIds?: unknown;
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

/** Reads a list of rows from one of the shapes the host uses. */
function rowsFrom(node: unknown, depth = 0): unknown[] {
  if (depth > 3) return [];
  if (Array.isArray(node)) return node;
  if (typeof node !== 'object' || node === null) return [];

  const record = node as WorkspaceFeed;

  // `{ items }` — the baseline payload.
  if (Array.isArray(record.items)) return record.items;

  // `{ type: 'baseline', value: { items } }` — what the Host controller really
  // yields. Missing this made folders silently empty on the desktop while the
  // capability said they were supported.
  if ('value' in record) return rowsFrom(record.value, depth + 1);

  return [];
}

/** Extracts the rows from whatever wrapper the host used. */
export function rowsOf(payload: unknown): unknown[] {
  return rowsFrom(payload);
}

/** Session ids the desktop has archived, from the same baseline. */
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

/**
 * Sessions the desktop has archived.
 *
 * The session list does **not** consult this: the host keeps the row and the archive only
 * marks it. Without this, archiving from the phone looks broken — the user taps Archive,
 * the host obeys, and the row is still there.
 */
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
  } catch {
    // Sin dato, no se oculta nada: es peor esconder una sesión viva que mostrar una cerrada.
  }

  return new Set();
}

/** Maps a payload of rows, dropping the unusable ones. */
export function toWorkspaces(payload: unknown): Workspace[] {
  return rowsOf(payload)
    .map(toWorkspace)
    .filter((workspace): workspace is Workspace => workspace !== undefined);
}

/**
 * Takes the first frame that carries rows.
 *
 * The abort is only a request: a stream that ignores the signal would keep the
 * `for await` waiting forever, so the reading is **raced against the timer**. The
 * earlier version aborted and hoped, which meant a host that ignores aborts hung the
 * command despite the comment saying it could not.
 */
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
      // El baseline llega siempre primero y es la foto completa, aunque esté vacío.
      // Esperar a que traiga algo convertía "no hay carpetas" en 1,5 s de espera, y
      // `listSessions` lee dos veces: la primera pantalla tardaba tres segundos.
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
      // Puede devolver una promesa: sin `await` una lista asíncrona se mapeaba como
      // si fuera un array vacío.
      return toWorkspaces(await controller.list());
    }

    if (typeof controller.follow === 'function') {
      return toWorkspaces(await firstFrame(controller.follow.bind(controller)));
    }
  } catch {
    // A host that answers with something unexpected is a host without folders.
  }

  return [];
}

/**
 * `true` if this host can answer `workspace.list`.
 *
 * **Never throws.** It is called while the plugin loads, so a host whose controller
 * has a throwing getter would take the whole plugin down over a capability flag.
 */
export function hasWorkspaces(ctx: HostContext): boolean {
  try {
    const controller = service<WorkspaceController>(ctx, 'workspaceController');
    if (!controller) return false;
    return typeof controller.list === 'function' || typeof controller.follow === 'function';
  } catch {
    return false;
  }
}
