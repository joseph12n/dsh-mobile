import { describe, expect, it } from 'vitest';
import { SessionSummary, Workspace, WorkspaceOkMessage, WorkspaceListMessage } from './index.js';

/**
 * Workspaces are the desktop folders. The contract has to work **with and without**
 * them: a host that does not expose workspaces must still be a valid host, and the
 * app has to fall back to a flat list instead of breaking.
 */

const workspace = {
  id: 'ws-1',
  title: 'dsh-mobile',
  directory: 'C:/work/dsh-mobile',
  order: 0,
};

const session = {
  id: 's1',
  title: 'Fix the build',
  state: 'idle' as const,
  updatedAt: 1_800_000_000_000,
  seq: 4,
  pendingQuestions: 0,
};

describe('workspace contract', () => {
  it('parses a folder', () => {
    expect(Workspace.parse(workspace)).toEqual(workspace);
  });

  it('accepts an empty title: the desktop then shows the directory name', () => {
    expect(Workspace.parse({ ...workspace, title: '' }).title).toBe('');
  });

  it('rejects a folder without a directory', () => {
    expect(() => Workspace.parse({ id: 'a', title: 'b', order: 0 })).toThrow();
  });

  it('a session may belong to a folder', () => {
    expect(SessionSummary.parse({ ...session, workspaceId: 'ws-1' }).workspaceId).toBe('ws-1');
  });

  it('a session without a folder is still valid: not every host has workspaces', () => {
    const parsed = SessionSummary.parse(session);
    expect(parsed.workspaceId).toBeUndefined();
  });

  it('an empty folder list is a valid answer', () => {
    const message = {
      v: 1 as const,
      id: 'm1',
      at: 1,
      type: 'workspace.ok' as const,
      workspaces: [],
    };
    expect(WorkspaceOkMessage.parse(message).workspaces).toEqual([]);
  });

  it('the request carries no payload', () => {
    const parsed = WorkspaceListMessage.parse({ v: 1, id: 'm1', at: 1, type: 'workspace.list' });
    expect(parsed.type).toBe('workspace.list');
  });
});
