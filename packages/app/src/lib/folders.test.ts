import { describe, expect, it } from 'vitest';
import type { SessionSummary, Workspace } from '@dsh-mobile/protocol';
import { byUrgency, displayTitle, groupByFolder, usesFolders } from './folders.js';

/**
 * Grouping by folder.
 *
 * The cases that matter are the awkward ones: a session pointing at a folder that no
 * longer exists, a folder with nothing in it, and a session with no folder at all. A
 * grouping that loses a session is worse than a flat list.
 */

const NOW = 1_800_000_000_000;

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    title: `Folder ${id}`,
    directory: `/work/${id}`,
    sessionIds: [],
    ...overrides,
  };
}

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    title: `Session ${id}`,
    state: 'idle',
    updatedAt: NOW,
    seq: 1,
    pendingQuestions: 0,
    ...overrides,
  };
}

describe('grouping sessions into folders', () => {
  it('puts each session in its folder', () => {
    const sections = groupByFolder(
      [
        session('a', { workspaceId: 'w1' }),
        session('b', { workspaceId: 'w2' }),
        session('c', { workspaceId: 'w1' }),
      ],
      [workspace('w1'), workspace('w2')],
    );

    expect(sections.map((section) => section.sessions.map((item) => item.id))).toEqual([
      ['a', 'c'],
      ['b'],
    ]);
  });

  it('keeps the host order of the folders', () => {
    // The order is what the desktop shows; re-sorting it here would disagree with it.
    const sections = groupByFolder([], [workspace('z'), workspace('a')]);
    expect(sections.map((section) => section.workspace?.id)).toEqual(['z', 'a']);
  });

  it('keeps a folder with no sessions', () => {
    // Hiding it makes the app look like it lost a folder.
    const sections = groupByFolder(
      [session('a', { workspaceId: 'w2' })],
      [workspace('w1'), workspace('w2')],
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]?.sessions).toEqual([]);
  });

  it('does not lose a session whose folder is gone', () => {
    // A folder can be removed on the desktop while a session still points at it.
    const sections = groupByFolder([session('a', { workspaceId: 'deleted' })], [workspace('w1')]);
    const all = sections.flatMap((section) => section.sessions.map((item) => item.id));
    expect(all).toEqual(['a']);
    expect(sections.at(-1)?.workspace).toBeUndefined();
  });

  it('does not lose a session with no folder', () => {
    const sections = groupByFolder(
      [session('a'), session('b', { workspaceId: 'w1' })],
      [workspace('w1')],
    );
    const all = sections.flatMap((section) => section.sessions.map((item) => item.id));
    expect(all.sort()).toEqual(['a', 'b']);
  });

  it('omits the no-folder group when it would be empty', () => {
    const sections = groupByFolder([session('a', { workspaceId: 'w1' })], [workspace('w1')]);
    expect(sections).toHaveLength(1);
  });

  it('orders inside a folder by urgency, then recency', () => {
    const sections = groupByFolder(
      [
        session('idle-old', { workspaceId: 'w1', updatedAt: NOW - 9_000 }),
        session('idle-new', { workspaceId: 'w1', updatedAt: NOW }),
        session('working', { workspaceId: 'w1', state: 'working', updatedAt: NOW - 5_000 }),
        session('waiting', { workspaceId: 'w1', pendingQuestions: 2, updatedAt: NOW - 8_000 }),
      ],
      [workspace('w1')],
    );

    expect(sections[0]?.sessions.map((item) => item.id)).toEqual([
      'waiting',
      'working',
      'idle-new',
      'idle-old',
    ]);
  });

  it('a waiting session beats a working one', () => {
    // What blocks the agent is what the human has to look at first.
    expect(
      byUrgency(session('w', { pendingQuestions: 1 }), session('t', { state: 'working' })),
    ).toBeLessThan(0);
  });

  it('with no folders it returns nothing, so the caller keeps the flat list', () => {
    expect(groupByFolder([session('a')], [])).toEqual([]);
    expect(usesFolders([])).toBe(false);
    expect(usesFolders([workspace('w1')])).toBe(true);
  });
});

describe('folder title', () => {
  it('uses the stored title', () => {
    expect(displayTitle(workspace('w1', { title: 'dsh-mobile' }))).toBe('dsh-mobile');
  });

  it('falls back to the directory name, last segment only', () => {
    // A full path does not fit on a phone.
    expect(displayTitle(workspace('w1', { title: '', directory: 'C:/work/dsh-mobile' }))).toBe(
      'dsh-mobile',
    );
    expect(
      displayTitle(workspace('w1', { title: '   ', directory: '/home/me/projects/app/' })),
    ).toBe('app');
  });

  it('copes with a directory that has no segments', () => {
    expect(displayTitle(workspace('w1', { title: '', directory: '/' }))).toBe('/');
  });
});
