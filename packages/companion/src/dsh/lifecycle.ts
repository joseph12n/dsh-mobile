/**
 * Session lifecycle from the phone: create inside a folder, archive.
 *
 * Both live behind host services the plugin does not inject, so they are reached
 * through the reflection proxy and every one of them may be missing. Shapes come from
 * the packaged app, not from guessing:
 *
 *  - `sessionController.createSession({ cwd })` — a session needs a **directory**, which
 *    is why creating one means creating it in a folder.
 *  - `workspaceController.archiveSession(sessionId, { stopActivity })` — the desktop
 *    refuses to archive a session with running work unless told to stop it first.
 */
import { service, type HostContext } from '../host-api.js';
import { listWorkspaces, type WorkspaceController } from './workspaces.js';

/** The part of the session controller we use. */
interface SessionLifecycleController {
  createSession?: (request: {
    sessionId?: string;
    cwd: string;
    agentPreset?: string;
    reusable?: boolean;
  }) => Promise<{ session?: { sessionId?: unknown }; preset?: unknown }>;
}

export type CreateResult =
  | { ok: true; sessionId: string; seq: number }
  | { ok: false; code: 'no-folder' | 'no-service' | 'failed'; message: string };

/** `true` if a session can be created at all on this host. */
export function canCreateSession(ctx: HostContext): boolean {
  try {
    const controller = service<SessionLifecycleController>(ctx, 'sessionController');
    return typeof controller?.createSession === 'function';
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

/**
 * Creates a session in an existing folder.
 *
 * The folder is looked up first: a session is born in a directory, so a workspace id
 * that does not exist is a failure, not something to invent a directory for.
 */
export async function createSession(
  ctx: HostContext,
  request: { workspaceId: string; prompt?: string },
): Promise<CreateResult> {
  const controller = service<SessionLifecycleController>(ctx, 'sessionController');
  if (!controller || typeof controller.createSession !== 'function') {
    return { ok: false, code: 'no-service', message: 'This host cannot create sessions.' };
  }

  const workspaces = await listWorkspaces(ctx);
  const workspace = workspaces.find((candidate) => candidate.id === request.workspaceId);
  if (!workspace) {
    return { ok: false, code: 'no-folder', message: 'That folder no longer exists.' };
  }

  try {
    const created = await controller.createSession({ cwd: workspace.directory });
    const sessionId = created?.session?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) {
      return { ok: false, code: 'failed', message: 'The host did not return a session.' };
    }

    // `seq` starts at zero: a brand new session has no events to catch up on.
    return { ok: true, sessionId, seq: 0 };
  } catch (error) {
    return { ok: false, code: 'failed', message: String(error) };
  }
}

export type ArchiveResult =
  { ok: true } | { ok: false; code: 'no-service' | 'active' | 'failed'; message: string };

/**
 * Archives a session.
 *
 * `stopActivity` matters: the desktop refuses to archive a session with a running turn
 * unless it is told to stop it, and that refusal is useful — the phone shows it instead
 * of silently killing work.
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
    await controller.archiveSession(
      request.sessionId,
      request.stopActivity === true ? { stopActivity: true } : {},
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // El host usa un código estable para «tiene trabajo en marcha».
    if (/session-active/.test(message)) {
      return {
        ok: false,
        code: 'active',
        message: 'That session has work running. Stop it first.',
      };
    }
    return { ok: false, code: 'failed', message };
  }
}
