import { service, type HostContext } from '../host-api.js';
import type { WorkspaceController } from './workspaces.js';
import { codeOf, messageOf } from './errors.js';

interface SessionLifecycleController {
  create?: (request: {
    workspaceId?: string;
    cwd?: string;
    agentPreset?: string;
    reusable?: boolean;
  }) => Promise<{ sessionId?: unknown; agentPreset?: unknown }>;
}

export function canCreateSession(ctx: HostContext): boolean {
  try {
    const controller = service<SessionLifecycleController>(ctx, 'sessionController');
    return typeof controller?.create === 'function';
  } catch {
    return false;
  }
}

export function canArchiveSession(ctx: HostContext): boolean {
  try {
    const controller = service<WorkspaceController>(ctx, 'workspaceController');
    return typeof controller?.archiveSession === 'function';
  } catch {
    return false;
  }
}

export function canUnarchiveSession(ctx: HostContext): boolean {
  try {
    const controller = service<WorkspaceController>(ctx, 'workspaceController');
    return typeof controller?.unarchiveSession === 'function';
  } catch {
    return false;
  }
}

export type CreateResult =
  | { ok: true; sessionId: string }
  | { ok: false; code: 'no-service' | 'no-folder' | 'failed'; message: string };

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

export type UnarchiveResult =
  { ok: true } | { ok: false; code: 'no-service' | 'not-found' | 'failed'; message: string };

export async function unarchiveSession(
  ctx: HostContext,
  request: { sessionId: string },
): Promise<UnarchiveResult> {
  const controller = service<WorkspaceController>(ctx, 'workspaceController');
  if (!controller || typeof controller.unarchiveSession !== 'function') {
    return { ok: false, code: 'no-service', message: 'This host cannot unarchive sessions.' };
  }

  try {
    await controller.unarchiveSession({ sessionId: request.sessionId });
    return { ok: true };
  } catch (error) {
    const code = codeOf(error);
    if (code === 'session/not-found' || code === 'workspace/not-found') {
      return { ok: false, code: 'not-found', message: 'That session no longer exists.' };
    }
    return { ok: false, code: 'failed', message: messageOf(error) };
  }
}

export type ArchiveResult =
  | { ok: true }
  | { ok: false; code: 'no-service' | 'active' | 'not-found' | 'failed'; message: string };

export async function archiveSession(
  ctx: HostContext,
  request: { sessionId: string; stopActivity?: boolean },
): Promise<ArchiveResult> {
  const controller = service<WorkspaceController>(ctx, 'workspaceController');
  if (!controller || typeof controller.archiveSession !== 'function') {
    return { ok: false, code: 'no-service', message: 'This host cannot archive sessions.' };
  }

  try {
    await controller.archiveSession({
      sessionId: request.sessionId,
      ...(request.stopActivity === true ? { stopActivity: true } : {}),
    });
    return { ok: true };
  } catch (error) {
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
