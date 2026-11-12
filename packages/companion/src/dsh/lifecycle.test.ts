import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { archiveSession, canArchiveSession, canCreateSession, createSession } from './lifecycle.js';

/**
 * Session lifecycle, against the **real** host shapes.
 *
 * The first version of this file tested shapes that do not exist: `createSession` instead
 * of `create`, a nested `session.sessionId`, two arguments to `archive`, and a refusal
 * code looked up in the message. It was green and wrong. Every fixture here uses what the
 * packaged app actually exposes.
 */

/** An error the way the host throws it: a stable code plus a message. */
function coded(code: string, message = 'no'): Error {
  return Object.assign(new Error(message), { code });
}

function ctxWith(services: Record<string, unknown>): HostContext {
  return { get: (name: string) => services[name], ...services } as unknown as HostContext;
}

describe('creating a session', () => {
  it('asks the host with the workspace id, not with a cwd', async () => {
    // Con `cwd` la sesión se crea pero NO entra en la carpeta: la característica entera
    // se perdería en silencio.
    const seen: unknown[] = [];
    const ctx = ctxWith({
      sessionController: {
        create: async (request: unknown) => {
          seen.push(request);
          return { sessionId: 'new-1' };
        },
      },
    });

    const result = await createSession(ctx, { workspaceId: 'ws-1' });

    expect(result).toEqual({ ok: true, sessionId: 'new-1' });
    expect(seen).toEqual([{ workspaceId: 'ws-1' }]);
  });

  it('reads the flat response, not a nested one', async () => {
    // `create` devuelve `{ sessionId }`; `created.session.sessionId` siempre es undefined.
    const ctx = ctxWith({ sessionController: { create: async () => ({ sessionId: 'x' }) } });
    expect(await createSession(ctx, { workspaceId: 'w' })).toEqual({ ok: true, sessionId: 'x' });
  });

  it('reports a folder that no longer exists', async () => {
    const ctx = ctxWith({
      sessionController: {
        create: async () => {
          throw coded('workspace/not-found');
        },
      },
    });
    expect(await createSession(ctx, { workspaceId: 'gone' })).toMatchObject({
      ok: false,
      code: 'no-folder',
    });
  });

  it('refuses when the host has no create()', async () => {
    // `createSession` existe en el host pero es privado: llamarlo no hacía nada.
    const ctx = ctxWith({ sessionController: { createSession: async () => ({}) } });
    expect(await createSession(ctx, { workspaceId: 'w' })).toMatchObject({
      ok: false,
      code: 'no-service',
    });
  });

  it('refuses when the host returns no session id', async () => {
    const ctx = ctxWith({ sessionController: { create: async () => ({}) } });
    expect(await createSession(ctx, { workspaceId: 'w' })).toMatchObject({
      ok: false,
      code: 'failed',
    });
  });

  it('reports a throwing host instead of propagating', async () => {
    const ctx = ctxWith({
      sessionController: {
        create: async () => {
          throw new Error('boom');
        },
      },
    });
    expect(await createSession(ctx, { workspaceId: 'w' })).toMatchObject({
      ok: false,
      code: 'failed',
    });
  });

  it('knows whether it can create at all', () => {
    expect(canCreateSession(ctxWith({ sessionController: { create: async () => ({}) } }))).toBe(
      true,
    );
    expect(
      canCreateSession(ctxWith({ sessionController: { createSession: async () => ({}) } })),
    ).toBe(false);
    expect(canCreateSession(ctxWith({}))).toBe(false);
  });
});

describe('archiving a session', () => {
  it('passes ONE request object, as the host expects', async () => {
    const calls: unknown[] = [];
    const ctx = ctxWith({
      workspaceController: {
        archiveSession: async (request: unknown) => {
          calls.push(request);
        },
      },
    });

    await archiveSession(ctx, { sessionId: 's1' });
    await archiveSession(ctx, { sessionId: 's2', stopActivity: true });

    expect(calls).toEqual([{ sessionId: 's1' }, { sessionId: 's2', stopActivity: true }]);
  });

  it('reads the refusal code from error.code, not from the message', async () => {
    // El texto es `cannot archive session 'x': the session is active`: buscar
    // `session-active` ahí no acierta nunca.
    const ctx = ctxWith({
      workspaceController: {
        archiveSession: async () => {
          throw coded(
            'workspace/session-active',
            "cannot archive session 'x': the session is active (turn)",
          );
        },
      },
    });

    expect(await archiveSession(ctx, { sessionId: 'x' })).toMatchObject({
      ok: false,
      code: 'active',
    });
  });

  it('reports a session that no longer exists', async () => {
    const ctx = ctxWith({
      workspaceController: {
        archiveSession: async () => {
          throw coded('session/not-found');
        },
      },
    });
    expect(await archiveSession(ctx, { sessionId: 'x' })).toMatchObject({
      ok: false,
      code: 'not-found',
    });
  });

  it('archives it', async () => {
    const ctx = ctxWith({ workspaceController: { archiveSession: async () => undefined } });
    expect(await archiveSession(ctx, { sessionId: 's1' })).toEqual({ ok: true });
  });

  it('refuses when the host cannot archive', async () => {
    expect(await archiveSession(ctxWith({}), { sessionId: 's1' })).toMatchObject({
      ok: false,
      code: 'no-service',
    });
  });

  it('knows whether it can archive at all', () => {
    expect(
      canArchiveSession(ctxWith({ workspaceController: { archiveSession: async () => 1 } })),
    ).toBe(true);
    expect(canArchiveSession(ctxWith({ workspaceController: {} }))).toBe(false);
  });
});
