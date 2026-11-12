import { afterEach, describe, expect, it } from 'vitest';
import type { FolderSection } from './folders.js';
import { fakeStorage, restoreStorage } from './test-storage.js';
import {
  applyFolderPreferences,
  DEFAULT_FOLDER_PREFERENCES,
  folderListState,
  folderView,
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

afterEach(() => {
  restoreStorage();
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

    // Se comprueba **cuál** queda: una prueba de longitud sola pasaría aunque se
    // hubiera escondido la carpeta equivocada.
    const visible = applyFolderPreferences(sections, prefs({ hideEmpty: true }));
    expect(visible.map((item) => item.title)).toEqual(['full']);
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

describe('which message the empty list gets', () => {
  it('says nothing special when the host has no folders', () => {
    // Sin carpetas el grupo es la lista plana: no hay ningún estado que explicar.
    expect(folderListState([orphans()], prefs())).toBe('folders');
  });

  it('renders the folders when at least one is visible', () => {
    expect(folderListState([section('a'), section('b')], prefs({ hidden: ['a'] }))).toBe('folders');
  });

  it('says "all hidden" only when the user hid every folder', () => {
    expect(folderListState([section('a'), section('b')], prefs({ hidden: ['a', 'b'] }))).toBe(
      'all-hidden',
    );
  });

  it('does not blame the user when only the empty ones were left out', () => {
    // Es el primer arranque con «ocultar vacías»: en Ajustes está todo marcado, así que
    // decir «todas ocultas» era mentira y además borraba los botones de sesión nueva.
    expect(folderListState([section('a'), section('b')], prefs({ hideEmpty: true }))).toBe(
      'only-empty-hidden',
    );
  });

  it('prefers showing the empty folders over an empty screen', () => {
    // Si una carpeta tiene sesiones, no se oculta por hideEmpty.
    expect(
      folderListState([section('a', [3]), section('b')], prefs({ hideEmpty: true, hidden: [] })),
    ).toBe('folders');
  });

  it('does not warn when hidden folders coexist with sessions that have no folder', () => {
    expect(folderListState([section('a'), orphans()], prefs({ hidden: ['a'] }))).toBe('folders');
  });
});

describe('what the list actually shows', () => {
  it('hides the folders the user turned off', () => {
    const view = folderView([section('a', [1]), section('b', [2])], prefs({ hidden: ['a'] }));
    expect(view.sections.map((item) => item.title)).toEqual(['b']);
    expect(view.state).toBe('folders');
  });

  it('falls back to the empty folders instead of leaving nothing to tap', () => {
    // «Ocultar vacías» despeja la lista; no puede quitar los botones de sesión nueva.
    const view = folderView([section('a'), section('b')], prefs({ hideEmpty: true }));
    expect(view.state).toBe('only-empty-hidden');
    expect(view.sections.map((item) => item.title)).toEqual(['a', 'b']);
  });

  it('reports all-hidden and leaves no sections', () => {
    const view = folderView([section('a')], prefs({ hidden: ['a'] }));
    expect(view.state).toBe('all-hidden');
    expect(view.sections).toEqual([]);
  });

  it('orders the folders in the language it is given', () => {
    const view = folderView([section('b'), section('a')], prefs({ order: 'name' }), 'es');
    expect(view.sections.map((item) => item.title)).toEqual(['a', 'b']);
  });

  it('keeps the group without folder at the end', () => {
    const view = folderView([section('b'), orphans(), section('a')], prefs({ order: 'name' }));
    expect(view.sections.at(-1)?.title).toBe('');
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

  it('survives valid JSON that is not an object', () => {
    // `null` y `[]` son JSON válido: sin guarda, leer `.hidden` lanzaba y el catch lo
    // tapaba. La guarda hace que el motivo sea explícito.
    fakeStorage();
    for (const raw of ['null', '[]', '"texto"', '3']) {
      globalThis.localStorage.setItem(KEY, raw);
      expect(storedFolderPreferences()).toEqual(DEFAULT_FOLDER_PREFERENCES);
    }
  });

  it('ignores a wrong shape instead of trusting it', () => {
    fakeStorage();
    globalThis.localStorage.setItem(
      KEY,
      JSON.stringify({ hidden: 'a', hideEmpty: 'true', order: 1 }),
    );
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
