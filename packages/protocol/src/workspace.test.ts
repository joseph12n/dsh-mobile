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
    expect(Workspace.parse({ ...workspace, title: '' }).title).toBe('');
  });

  it('rejects a folder without a directory', () => {
    expect(() => Workspace.parse({ id: 'a', title: 'b', sessionIds: [] })).toThrow();
    expect(() => Workspace.parse({ ...workspace, directory: '' })).toThrow();
  });

  it('carries no order: the array order is the order', () => {
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
