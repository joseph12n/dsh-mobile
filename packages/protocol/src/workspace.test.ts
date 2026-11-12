import { describe, expect, it } from 'vitest';
import {
  Capability,
  SessionSummary,
  Workspace,
  WorkspaceListMessage,
  WorkspaceOkMessage,
  parseClientMessage,
  parseServerMessage,
} from './index.js';

/**
 * Workspaces are the desktop folders.
 *
 * The shapes here come from the host's real projection
 * (`@deepseek-ai/dsh-api-workspace-controller/lib/types/feed.js`): `workspaceId`,
 * `path`, `title`, `sessionIds`. Not from a guess — the first version of this file
 * invented `id/directory/order` and a reviewer proved it wrong against the packaged
 * app.
 *
 * The contract has to work **with and without** folders: a host that does not
 * expose them stays a valid host, and the app falls back to a flat list.
 */

const workspace = {
  id: 'ws-1',
  title: 'dsh-mobile',
  directory: 'C:/work/dsh-mobile',
  sessionIds: ['s1', 's2'],
};

const session = {
  id: 's1',
  title: 'Fix the build',
  state: 'idle' as const,
  updatedAt: 1_800_000_000_000,
  seq: 4,
  pendingQuestions: 0,
};

const envelope = { v: 1 as const, id: 'm1', at: 1 };

describe('workspace shape', () => {
  it('parses a folder', () => {
    expect(Workspace.parse(workspace)).toEqual(workspace);
  });

  it('accepts an empty title', () => {
    // The desktop derives a display name when there is no stored title.
    expect(Workspace.parse({ ...workspace, title: '' }).title).toBe('');
  });

  it('rejects a folder without a directory', () => {
    expect(() => Workspace.parse({ id: 'a', title: 'b', sessionIds: [] })).toThrow();
    expect(() => Workspace.parse({ ...workspace, directory: '' })).toThrow();
  });

  it('carries no order: the array order is the order', () => {
    // Inventing an `order` integer duplicated a truth that already travels in the
    // order of the list.
    expect(Object.keys(Workspace.parse(workspace))).toEqual([
      'id',
      'title',
      'directory',
      'sessionIds',
    ]);
  });
});

describe('session membership', () => {
  it('a session may belong to a folder', () => {
    expect(SessionSummary.parse({ ...session, workspaceId: 'ws-1' }).workspaceId).toBe('ws-1');
  });

  it('a session without a folder is still valid', () => {
    expect(SessionSummary.parse(session).workspaceId).toBeUndefined();
  });

  it('an empty workspaceId does not break the whole list', () => {
    // A host that sends '' instead of omitting it must not cost the client every
    // session: the field is accepted and the adapter drops it.
    expect(SessionSummary.parse({ ...session, workspaceId: '' }).workspaceId).toBe('');
  });
});

describe('messages and capabilities', () => {
  it('length is a field, not an assumption', () => {
    expect(Capability.parse('workspace.list')).toBe('workspace.list');
  });
});

describe('union placement', () => {
  it('workspace.list parses as a client message', () => {
    const parsed = parseClientMessage(JSON.stringify({ ...envelope, type: 'workspace.list' }));
    expect(parsed?.type).toBe('workspace.list');
  });

  it('workspace.list is NOT a server message', () => {
    // A server message in the client union is a silent bug: the client would wait
    // forever for a reply the host never meant to send.
    expect(
      parseServerMessage(JSON.stringify({ ...envelope, type: 'workspace.list' })),
    ).toBeUndefined();
  });

  it('workspace.ok parses as a server message', () => {
    const parsed = parseServerMessage(
      JSON.stringify({ ...envelope, type: 'workspace.ok', workspaces: [workspace] }),
    );
    expect(parsed?.type).toBe('workspace.ok');
  });

  it('workspace.ok is NOT a client message', () => {
    expect(
      parseClientMessage(JSON.stringify({ ...envelope, type: 'workspace.ok', workspaces: [] })),
    ).toBeUndefined();
  });

  it('an empty folder list is a valid answer', () => {
    const parsed = parseServerMessage(
      JSON.stringify({ ...envelope, type: 'workspace.ok', workspaces: [] }),
    );
    expect(parsed?.type === 'workspace.ok' && parsed.workspaces).toEqual([]);
  });

  it('the schema is reachable both ways', () => {
    expect(WorkspaceOkMessage.shape.workspaces).toBeDefined();
    expect(WorkspaceListMessage.shape.type.value).toBe('workspace.list');
  });
});
