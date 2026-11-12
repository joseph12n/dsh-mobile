import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { archiveSession, canArchiveSession, canCreateSession, createSession } from './lifecycle.js';

/**
 * Session lifecycle.
 *
 * The important property is not that it works when everything is present, but that it
 * refuses cleanly when something is not: a phone that shows "this host cannot create
 * sessions" is better than one that throws.
 */

/** The host's own row shape: `workspaceId` and `path`, not `id` and `directory`. */
const folder = {
  workspaceId: 'ws-1',
  title: 'dsh-mobile',
  path: 'C:/work/dsh-mobile',
  sessionIds: [],
};

function ctxWith(services: Record<string, unknown>): HostContext {
  return {
    get: (name: string) => services[name],
    ...services,
  } as unknown as HostContext;
}

/** A host that can list folders, create sessions and archive them. */
function fullHost(overrides: Record<string, unknown> = {}): HostContext {
  return ctxWith({
    sessionController: {
      createSession: async () => ({ session: { sessionId: 'new-1' } }),
    },
    workspaceController: {
      list: () => [folder],
      archiveSession: async () => undefined,
    },
    ...overrides,
  });
}

describe('creating a session', () => {
  it('creates it in the folder the user picked', async () => {
    const seen: unknown[] = [];
    const ctx = fullHost({
      sessionController: {
        createSession: async (request: unknown) => {
          seen.push(request);
          return { session: { sessionId: 'new-1' } };
        },
      },
    });

    const result = await createSession(ctx, { workspaceId: 'ws-1' });

    expect(result).toEqual({ ok: true, sessionId: 'new-1', seq: 0 });
    // La sesión nace en el DIRECTORIO de la carpeta: es lo único que el host acepta.
    expect(seen).toEqual([{ cwd: 'C:/work/dsh-mobile' }]);
  });

  it('refuses a folder that no longer exists instead of inventing a directory', async () => {
    const result = await createSession(fullHost(), { workspaceId: 'gone' });
    expect(result).toMatchObject({ ok: false, code: 'no-folder' });
  });

  it('refuses when the host has no controller', async () => {
    const result = await createSession(ctxWith({}), { workspaceId: 'ws-1' });
    expect(result).toMatchObject({ ok: false, code: 'no-service' });
  });

  it('refuses when the host returns no session id', async () => {
    const ctx = fullHost({ sessionController: { createSession: async () => ({}) } });
    const result = await createSession(ctx, { workspaceId: 'ws-1' });
    expect(result).toMatchObject({ ok: false, code: 'failed' });
  });

  it('reports a throwing host instead of propagating', async () => {
    const ctx = fullHost({
      sessionController: {
        createSession: async () => {
          throw new Error('boom');
        },
      },
    });
    const result = await createSession(ctx, { workspaceId: 'ws-1' });
    expect(result).toMatchObject({ ok: false, code: 'failed' });
  });

  it('knows whether it can create at all', () => {
    expect(canCreateSession(fullHost())).toBe(true);
    expect(canCreateSession(ctxWith({ sessionController: {} }))).toBe(false);
    expect(canCreateSession(ctxWith({}))).toBe(false);
  });
});

describe('archiving a session', () => {
  it('archives it', async () => {
    const result = await archiveSession(fullHost(), { sessionId: 's1' });
    expect(result).toEqual({ ok: true });
  });

  it('passes stopActivity only when asked', async () => {
    const calls: unknown[] = [];
    const ctx = fullHost({
      workspaceController: {
        list: () => [folder],
        archiveSession: async (id: string, options: unknown) => {
          calls.push([id, options]);
        },
      },
    });

    await archiveSession(ctx, { sessionId: 's1' });
    await archiveSession(ctx, { sessionId: 's2', stopActivity: true });

    expect(calls).toEqual([
      ['s1', {}],
      ['s2', { stopActivity: true }],
    ]);
  });

  it('turns a refusal for running work into a message the user can act on', async () => {
    // El host usa `workspace/session-active`; matar trabajo ajeno en silencio sería peor.
    const ctx = fullHost({
      workspaceController: {
        list: () => [folder],
        archiveSession: async () => {
          throw new Error('workspace/session-active: a turn is running');
        },
      },
    });

    const result = await archiveSession(ctx, { sessionId: 's1' });
    expect(result).toMatchObject({ ok: false, code: 'active' });
  });

  it('refuses when the host cannot archive', async () => {
    const result = await archiveSession(ctxWith({}), { sessionId: 's1' });
    expect(result).toMatchObject({ ok: false, code: 'no-service' });
  });

  it('knows whether it can archive at all', () => {
    expect(canArchiveSession(fullHost())).toBe(true);
    expect(canArchiveSession(ctxWith({ workspaceController: {} }))).toBe(false);
  });
});
