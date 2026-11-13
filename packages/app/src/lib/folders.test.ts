import { describe, expect, it } from 'vitest';
import type { SessionSummary, Workspace } from '@dsh-mobile/protocol';
import {
  byUrgency,
  compactPath,
  displayTitle,
  folderAccent,
  groupByFolder,
  parentPath,
  usesFolders,
} from './folders.js';

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
    const sections = groupByFolder([], [workspace('z'), workspace('a')]);
    expect(sections.map((section) => section.workspace?.id)).toEqual(['z', 'a']);
  });

  it('keeps a folder with no sessions', () => {
    const sections = groupByFolder(
      [session('a', { workspaceId: 'w2' })],
      [workspace('w1'), workspace('w2')],
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]?.sessions).toEqual([]);
  });

  it('does not lose a session whose folder is gone', () => {
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

describe('folder location', () => {
  it.each([
    ['C:\\Users\\me\\project', 'C:\\Users\\me'],
    ['C:/work/api/', 'C:/work'],
    ['/home/me/app', '/home/me'],
    ['\\\\server\\share\\folder', '\\\\server\\share'],
    ['C:\\', ''],
    ['/', ''],
    ['project', ''],
  ])('takes the parent of %s', (directory, expected) => {
    expect(parentPath(directory)).toBe(expected);
  });

  it('compacts what the header shows to the useful tail', () => {
    expect(compactPath(parentPath('C:\\Users\\josep\\OneDrive\\Documentos\\dsh-mobile'))).toBe(
      '…\\OneDrive\\Documentos',
    );
    expect(compactPath('/home/me/projects/api')).toBe('…/projects/api');
  });

  it('leaves a path with nothing to compact alone', () => {
    expect(compactPath('C:\\work')).toBe('C:\\work');
    expect(compactPath('')).toBe('');
  });
});

describe('folder accent', () => {
  it('stays the same for the same folder', () => {
    expect(folderAccent('ws-app')).toBe(folderAccent('ws-app'));
  });

  it('returns a palette colour', () => {
    expect(folderAccent('ws-app')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('does not paint every folder the same', () => {
    const colours = new Set(['ws-app', 'ws-api', 'ws-web', 'ws-lab'].map(folderAccent));
    expect(colours.size).toBeGreaterThan(1);
  });
});
