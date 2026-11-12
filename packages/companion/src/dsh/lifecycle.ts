/**
 * Session lifecycle from the phone: create inside a folder, archive.
 *
 * Every shape here was read from the packaged app after a review proved my first version
 * was wrong on all of them. Written down so the next reader does not repeat it:
 *
 *  - `ctx.sessionController` exposes **`create(request)`**, not `createSession`. The name
 *    `createSession` exists, but it is private on an internal controller.
 *  - `create` returns **`{ sessionId, agentPreset? }`**, flat — there is no `session` field.
 *  - `create` accepts **`workspaceId` XOR `cwd`**, and only the `workspaceId` form calls
 *    `workspace.attachSession()`. With `cwd` the session is created but **not** a member of
 *    the folder, which would silently defeat the whole feature.
 *  - `archiveSession` takes **one request object**, not `(id, options)`.
 *  - the refusal for running work carries its code on **`error.code`** as
 *    `workspace/session-active`; the message text does not contain it.
 */
import { service, type HostContext } from '../host-api.js';
import type { WorkspaceController } from './workspaces.js';

/** The part of the session controller we use. */
interface SessionLifecycleController {
  create?: (request: {
    workspaceId?: string;
    cwd?: string;
    agentPreset?: string;
    reusable?: boolean;
  }) => Promise<{ sessionId?: unknown; agentPreset?: unknown }>;
}

/** An error that carries a stable code, which is how the host reports refusals. */
interface CodedError {
  code?: unknown;
  message?: unknown;
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as CodedError;
  return typeof code === 'string' ? code : undefined;
}

function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { message } = error as CodedError;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

/** `true` if a session can be created on this host. */
export function canCreateSession(ctx: HostContext): boolean {
  try {
    const controller = service<SessionLifecycleController>(ctx, 'sessionController');
    return typeof controller?.create === 'function';
  } catch {
    return false;
  }
}

/** `true` if sessions can be archived on this host. */
export function canArchiveSession(ctx: HostContext): boolean {
  try {
    const controller = service<WorkspaceController>(ctx, 'workspaceController');
    return typeof controller?.archiveSession === 'function';
  } catch {
    return false;
  }
}

export type CreateResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: 'no-service' | 'no-folder' | 'failed'; message: string };

/**
 * Creates a session inside an existing folder.
 *
 * `workspaceId` is passed, **not** `cwd`: only that form makes the session a member of the
 * folder. The host validates the id, so a folder that no longer exists comes back as its
 * own error instead of being guessed at here.
 */
export async function createSession(
  ctx: HostContext,
  request: { workspaceId: string },
): Promise<CreateResult> {
  const controller = service<SessionLifecycleController>(ctx, 'sessionController');
  if (!controller || typeof controller.create !== 'function') {
    return { ok: false, code: 'no-service', message: 'This host cannot create sessions.' };
  }

  try {
    const created = await controller.create({ workspaceId: request.workspaceId });
    const sessionId = created?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) {
      return { ok: false, code: 'failed', message: 'The host did not return a session.' };
    }
    return { ok: true, sessionId };
  } catch (error) {
    const code = codeOf(error);
    if (code === 'workspace/not-found' || code === 'session/not-found') {
      return { ok: false, code: 'no-folder', message: 'That folder no longer exists.' };
    }
    return { ok: false, code: 'failed', message: messageOf(error) };
  }
}

export type ArchiveResult =
  | { ok: true }
  | { ok: false; code: 'no-service' | 'active' | 'not-found' | 'failed'; message: string };

/**
 * Archives a session.
 *
 * `stopActivity` matters: the host refuses to archive a session with a running turn, and
 * that refusal is surfaced as `active` so the phone can say "stop it first" instead of
 * killing work behind the user's back.
 */
export async function archiveSession(
  ctx: HostContext,
  request: { sessionId: string; stopActivity?: boolean },
): Promise<ArchiveResult> {
  const controller = service<WorkspaceController>(ctx, 'workspaceController');
  if (!controller || typeof controller.archiveSession !== 'function') {
    return { ok: false, code: 'no-service', message: 'This host cannot archive sessions.' };
  }

  try {
    // Un solo objeto: la firma real es `archiveSession(request)`.
    await controller.archiveSession({
      sessionId: request.sessionId,
      ...(request.stopActivity === true ? { stopActivity: true } : {}),
    });
    return { ok: true };
  } catch (error) {
    // El código va en `error.code`, no en el texto: buscar en el mensaje no acertaba nunca.
    const code = codeOf(error);
    if (code === 'workspace/session-active') {
      return {
        ok: false,
        code: 'active',
        message: 'That session has work running. Stop it first.',
      };
    }
    if (code === 'session/not-found' || code === 'workspace/not-found') {
      return { ok: false, code: 'not-found', message: 'That session no longer exists.' };
    }
    return { ok: false, code: 'failed', message: messageOf(error) };
  }
}
