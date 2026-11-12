import { afterEach, describe, expect, it } from 'vitest';
import type { FolderSection } from './folders.js';
import {
  applyFolderPreferences,
  DEFAULT_FOLDER_PREFERENCES,
  isFolderOrder,
  storeFolderPreferences,
  storedFolderPreferences,
  toggleHidden,
  type FolderPreferences,
} from './preferences.js';

/**
 * Folder preferences.
 *
 * The interesting cases are the ones that hide something by mistake: a session with no
 * folder must stay reachable, and an unknown stored value must not empty the list.
 */

const KEY = 'dsh-mobile.folders';
const original = globalThis.localStorage;

/** A `localStorage` good enough for the module, in a Node environment. */
function fakeStorage(options: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): void {
  const data = new Map<string, string>();

  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem(key: string): string | null {
      if (options.throwOnGet) throw new Error('denied');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (options.throwOnSet) throw new Error('full');
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
  };
}

afterEach(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage = original;
});

/** A folder section with the given sessions' activity times. */
function section(id: string, updatedAt: number[] = []): FolderSection {
  return {
    workspace: { id, title: id, directory: `/work/${id}`, sessionIds: [] },
    title: id,
    sessions: updatedAt.map((at, index) => ({
      id: `${id}-${index}`,
      title: '',
      state: 'idle' as const,
      updatedAt: at,
      seq: 0,
      pendingQuestions: 0,
      workspaceId: id,
    })),
  };
}

/** The group that collects sessions whose folder is unknown. */
function orphans(count = 1): FolderSection {
  return {
    title: '',
    sessions: Array.from({ length: count }, (_, index) => ({
      id: `orphan-${index}`,
      title: '',
      state: 'idle' as const,
      updatedAt: 0,
      seq: 0,
      pendingQuestions: 0,
    })),
  };
}

function prefs(overrides: Partial<FolderPreferences> = {}): FolderPreferences {
  return { ...DEFAULT_FOLDER_PREFERENCES, ...overrides };
}

describe('applying the preferences', () => {
  it('keeps the host order by default', () => {
    const sections = [section('b', [5]), section('a', [9])];
    expect(applyFolderPreferences(sections, prefs()).map((item) => item.title)).toEqual(['b', 'a']);
  });

  it('hides the folders the user turned off', () => {
    const sections = [section('a'), section('b')];
    const visible = applyFolderPreferences(sections, prefs({ hidden: ['a'] }));
    expect(visible.map((item) => item.title)).toEqual(['b']);
  });

  it('never hides the sessions with no folder', () => {
    // No tienen id que ocultar: si desaparecieran, no habría forma de llegar a ellas.
    const visible = applyFolderPreferences([section('a'), orphans()], prefs({ hidden: ['a'] }));
    expect(visible.map((item) => item.title)).toEqual(['']);
  });

  it('keeps empty folders unless asked to drop them', () => {
    const sections = [section('empty'), section('full', [1])];
    expect(applyFolderPreferences(sections, prefs())).toHaveLength(2);
    expect(applyFolderPreferences(sections, prefs({ hideEmpty: true }))).toHaveLength(1);
  });

  it('orders by name when asked', () => {
    const sections = [section('zeta'), section('alfa'), orphans()];
    const visible = applyFolderPreferences(sections, prefs({ order: 'name' }));
    expect(visible.map((item) => item.title)).toEqual(['alfa', 'zeta', '']);
  });

  it('orders by the most recent session when asked', () => {
    const sections = [section('vieja', [10]), section('nueva', [99]), section('vacía')];
    const visible = applyFolderPreferences(sections, prefs({ order: 'recent' }));
    expect(visible.map((item) => item.title)).toEqual(['nueva', 'vieja', 'vacía']);
  });

  it('leaves the orphan group last even when the folders are sorted', () => {
    const visible = applyFolderPreferences(
      [section('b'), orphans(), section('a')],
      prefs({ order: 'name' }),
    );
    expect(visible.at(-1)?.title).toBe('');
  });
});

describe('toggling a folder', () => {
  it('hides and shows without touching anything else', () => {
    const first = toggleHidden(prefs({ order: 'name' }), 'a');
    expect(first).toMatchObject({ hidden: ['a'], order: 'name', hideEmpty: false });

    const second = toggleHidden(first, 'a');
    expect(second.hidden).toEqual([]);
  });

  it('keeps the other hidden ids', () => {
    expect(toggleHidden(prefs({ hidden: ['x'] }), 'y').hidden).toEqual(['x', 'y']);
  });
});

describe('reading and storing', () => {
  it('is the default when nothing was stored', () => {
    fakeStorage();
    expect(storedFolderPreferences()).toEqual(DEFAULT_FOLDER_PREFERENCES);
  });

  it('round-trips what was stored', () => {
    fakeStorage();
    storeFolderPreferences({ hidden: ['a'], order: 'recent', hideEmpty: true });
    expect(storedFolderPreferences()).toEqual({ hidden: ['a'], order: 'recent', hideEmpty: true });
  });

  it('ignores an order it does not know', () => {
    fakeStorage();
    globalThis.localStorage.setItem(KEY, JSON.stringify({ order: 'wat', hidden: [] }));
    expect(storedFolderPreferences().order).toBe('host');
  });

  it('survives broken JSON from an older version', () => {
    fakeStorage();
    globalThis.localStorage.setItem(KEY, '{not json');
    expect(storedFolderPreferences()).toEqual(DEFAULT_FOLDER_PREFERENCES);
  });

  it('drops hidden ids that are not strings', () => {
    fakeStorage();
    globalThis.localStorage.setItem(KEY, JSON.stringify({ hidden: ['a', 3, '', null] }));
    expect(storedFolderPreferences().hidden).toEqual(['a']);
  });

  it('survives a storage that throws', () => {
    fakeStorage({ throwOnGet: true });
    expect(storedFolderPreferences()).toEqual(DEFAULT_FOLDER_PREFERENCES);

    fakeStorage({ throwOnSet: true });
    expect(() => storeFolderPreferences(DEFAULT_FOLDER_PREFERENCES)).not.toThrow();
  });

  it('survives having no storage at all', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = undefined;
    expect(storedFolderPreferences()).toEqual(DEFAULT_FOLDER_PREFERENCES);
    expect(() => storeFolderPreferences(DEFAULT_FOLDER_PREFERENCES)).not.toThrow();
  });

  it('accepts exactly the three orders it defines', () => {
    expect(isFolderOrder('host')).toBe(true);
    expect(isFolderOrder('name')).toBe(true);
    expect(isFolderOrder('recent')).toBe(true);
    expect(isFolderOrder('host ')).toBe(false);
    expect(isFolderOrder(undefined)).toBe(false);
  });
});
