import { useCallback, useEffect, useState } from 'react';
import type { FolderSection } from './folders.js';

/**
 * Folder preferences.
 *
 * The desktop decides which folders exist; the phone decides how they are shown. Three
 * things a phone screen needs and a desktop does not:
 *
 *  - **Hiding folders.** Most people work in two or three and the rest are noise on a
 *    6-inch screen.
 *  - **Ordering.** The host order is the desktop order, which is not necessarily the
 *    order of use on a phone.
 *  - **Empty folders.** They are where new sessions would go, so they are shown by
 *    default; on a crowded list they are also noise.
 *
 * The choice lives in `localStorage` like the contrast level, and the filtering and
 * ordering are a pure function so they can be tested without React.
 */

export const FOLDER_ORDERS = ['host', 'name', 'recent'] as const;
export type FolderOrder = (typeof FOLDER_ORDERS)[number];

export interface FolderPreferences {
  /** Workspace ids the phone hides. Sessions in them are not shown either. */
  hidden: readonly string[];
  order: FolderOrder;
  /** Leave the folders with no sessions out of the list. */
  hideEmpty: boolean;
}

export const DEFAULT_FOLDER_PREFERENCES: FolderPreferences = {
  hidden: [],
  order: 'host',
  hideEmpty: false,
};

const STORAGE_KEY = 'dsh-mobile.folders';

export function isFolderOrder(value: unknown): value is FolderOrder {
  return typeof value === 'string' && (FOLDER_ORDERS as readonly string[]).includes(value);
}

/** The stored preferences, or the defaults. A storage that throws is not a reason to fail. */
export function storedFolderPreferences(): FolderPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FOLDER_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<Record<keyof FolderPreferences, unknown>>;
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];

    return {
      hidden,
      order: isFolderOrder(parsed.order) ? parsed.order : 'host',
      hideEmpty: parsed.hideEmpty === true,
    };
  } catch {
    // Vale para almacenamiento roto y para JSON inválido de una versión anterior.
    return DEFAULT_FOLDER_PREFERENCES;
  }
}

export function storeFolderPreferences(preferences: FolderPreferences): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Sin persistencia se sigue viendo bien; solo no se recuerda.
  }
}

export interface FolderPreferencesState {
  preferences: FolderPreferences;
  setPreferences: (next: FolderPreferences) => void;
}

export function useFolderPreferences(): FolderPreferencesState {
  const [preferences, setState] = useState<FolderPreferences>(storedFolderPreferences);

  const setPreferences = useCallback((next: FolderPreferences) => {
    setState(next);
    storeFolderPreferences(next);
  }, []);

  // Se guarda también al montar: si la lectura encontró basura, queda reemplazada por
  // unos valores válidos en vez de reintentar el análisis en cada arranque.
  useEffect(() => {
    storeFolderPreferences(preferences);
  }, [preferences]);

  return { preferences, setPreferences };
}

/** Alterna una carpeta oculta, sin tocar el resto. */
export function toggleHidden(
  preferences: FolderPreferences,
  workspaceId: string,
): FolderPreferences {
  const hidden = preferences.hidden.includes(workspaceId)
    ? preferences.hidden.filter((id) => id !== workspaceId)
    : [...preferences.hidden, workspaceId];

  return { ...preferences, hidden };
}

/** Cuándo se actualizó por última vez la carpeta. Sin sesiones, cero. */
function lastActivity(section: FolderSection): number {
  return section.sessions.reduce((newest, session) => Math.max(newest, session.updatedAt), 0);
}

/**
 * Applies the preferences to the sections the host order produced.
 *
 * The group of sessions with no known folder is **never** hidden: it has no id to hide,
 * and those sessions would otherwise disappear with no way to reach them.
 */
export function applyFolderPreferences(
  sections: readonly FolderSection[],
  preferences: FolderPreferences,
): FolderSection[] {
  const visible = sections.filter((section) => {
    if (!section.workspace) return true;
    if (preferences.hidden.includes(section.workspace.id)) return false;
    // Una carpeta vacía se conserva salvo que se pida lo contrario: es donde irían las
    // sesiones nuevas.
    return !(preferences.hideEmpty && section.sessions.length === 0);
  });

  if (preferences.order === 'host') return [...visible];

  const folders = visible.filter((section) => section.workspace !== undefined);
  const orphans = visible.filter((section) => section.workspace === undefined);

  const sorted =
    preferences.order === 'name'
      ? [...folders].sort((left, right) => left.title.localeCompare(right.title))
      : [...folders].sort((left, right) => lastActivity(right) - lastActivity(left));

  // Sin carpeta va siempre al final: no es una carpeta, es lo que sobró.
  return [...sorted, ...orphans];
}
