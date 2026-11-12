import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { hasWorkspaces, listWorkspaces, rowsOf, toWorkspace } from './workspaces.js';

/**
 * The folder adapter.
 *
 * It has to survive three very different hosts: one with `list`, one that only
 * streams, and one with no workspaces at all. The third is not a failure — it is the
 * host this project had until yesterday, and it must keep working.
 */

const row = {
  workspaceId: 'ws-1',
  path: 'C:/work/dsh-mobile',
  title: 'dsh-mobile',
  sessionIds: ['s1', 's2'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

/** A context whose `workspaceController` is whatever the test needs. */
function ctxWith(controller: unknown): HostContext {
  return { workspaceController: controller } as HostContext;
}

describe('mapping a row', () => {
  it('renames the host fields to the contract ones', () => {
    expect(toWorkspace(row)).toEqual({
      id: 'ws-1',
      title: 'dsh-mobile',
      directory: 'C:/work/dsh-mobile',
      sessionIds: ['s1', 's2'],
    });
  });

  it('drops timestamps: the protocol does not use them', () => {
    expect(Object.keys(toWorkspace(row) ?? {})).not.toContain('createdAt');
  });

  it('keeps an empty title', () => {
    expect(toWorkspace({ ...row, title: '' })?.title).toBe('');
  });

  it('drops a row without an id or a path', () => {
    // A folder that cannot be opened cannot be shown either.
    expect(toWorkspace({ ...row, workspaceId: undefined })).toBeUndefined();
    expect(toWorkspace({ ...row, path: '' })).toBeUndefined();
    expect(toWorkspace(null)).toBeUndefined();
    expect(toWorkspace('nope')).toBeUndefined();
  });

  it('cleans the session list', () => {
    expect(toWorkspace({ ...row, sessionIds: ['a', '', 3, null, 'b'] })?.sessionIds).toEqual([
      'a',
      'b',
    ]);
    expect(toWorkspace({ ...row, sessionIds: 'nope' })?.sessionIds).toEqual([]);
  });
});

describe('reading the payload shape', () => {
  it('accepts a bare array', () => {
    expect(rowsOf([row])).toHaveLength(1);
  });

  it('accepts the baseline wrapper', () => {
    expect(rowsOf({ items: [row], archivedSessionIds: [], pinnedSessionIds: [] })).toHaveLength(1);
  });

  it('returns nothing for anything else', () => {
    expect(rowsOf(undefined)).toEqual([]);
    expect(rowsOf({ items: 'nope' })).toEqual([]);
  });
});

describe('reading from a host', () => {
  it('uses list() when it exists', async () => {
    const workspaces = await listWorkspaces(ctxWith({ list: () => [row] }));
    expect(workspaces).toHaveLength(1);
  });

  it('falls back to the first baseline of follow()', async () => {
    const controller = {
      async *follow() {
        yield { items: [row], archivedSessionIds: [], pinnedSessionIds: [] };
        yield { items: [] };
      },
    };

    const workspaces = await listWorkspaces(ctxWith(controller));
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.id).toBe('ws-1');
  });

  it('returns no folders when the host has neither', async () => {
    expect(await listWorkspaces(ctxWith({}))).toEqual([]);
    expect(await listWorkspaces({} as HostContext)).toEqual([]);
  });

  it('does not throw when the host throws', async () => {
    const workspaces = await listWorkspaces(
      ctxWith({
        list: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(workspaces).toEqual([]);
  });

  it('does not throw when the stream throws', async () => {
    const controller = {
      // eslint-disable-next-line require-yield
      async *follow() {
        throw new Error('boom');
      },
    };
    expect(await listWorkspaces(ctxWith(controller))).toEqual([]);
  });

  it('drops unusable rows instead of failing the whole list', async () => {
    const workspaces = await listWorkspaces(
      ctxWith({ list: () => [row, { workspaceId: 'x' }, { path: 'y' }] }),
    );
    expect(workspaces.map((workspace) => workspace.id)).toEqual(['ws-1']);
  });
});

describe('availability', () => {
  it('is true only when there is something to call', () => {
    expect(hasWorkspaces(ctxWith({ list: () => [] }))).toBe(true);
    expect(hasWorkspaces(ctxWith({ follow: async function* () {} }))).toBe(true);
    expect(hasWorkspaces(ctxWith({}))).toBe(false);
    expect(hasWorkspaces({} as HostContext)).toBe(false);
  });
});
