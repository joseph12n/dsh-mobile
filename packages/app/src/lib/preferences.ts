import { useCallback, useState } from 'react';
import type { FolderSection } from './folders.js';

export const FOLDER_ORDERS = ['host', 'name', 'recent'] as const;
export type FolderOrder = (typeof FOLDER_ORDERS)[number];

export interface FolderPreferences {
  hidden: readonly string[];
  order: FolderOrder;
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

export function storedFolderPreferences(): FolderPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FOLDER_PREFERENCES;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FOLDER_PREFERENCES;

    const record = parsed as Partial<Record<keyof FolderPreferences, unknown>>;
    const hidden = Array.isArray(record.hidden)
      ? record.hidden.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];

    return {
      hidden,
      order: isFolderOrder(record.order) ? record.order : 'host',
      hideEmpty: record.hideEmpty === true,
    };
  } catch {
    return DEFAULT_FOLDER_PREFERENCES;
  }
}

export function storeFolderPreferences(preferences: FolderPreferences): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {}
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

  return { preferences, setPreferences };
}

export function toggleHidden(
  preferences: FolderPreferences,
  workspaceId: string,
): FolderPreferences {
  const hidden = preferences.hidden.includes(workspaceId)
    ? preferences.hidden.filter((id) => id !== workspaceId)
    : [...preferences.hidden, workspaceId];

  return { ...preferences, hidden };
}

function lastActivity(section: FolderSection): number {
  return section.sessions.reduce((newest, session) => Math.max(newest, session.updatedAt), 0);
}

export function applyFolderPreferences(
  sections: readonly FolderSection[],
  preferences: FolderPreferences,
  locale?: string,
): FolderSection[] {
  const visible = sections.filter((section) => {
    if (!section.workspace) return true;
    if (preferences.hidden.includes(section.workspace.id)) return false;
    return !(preferences.hideEmpty && section.sessions.length === 0);
  });

  if (preferences.order === 'host') return [...visible];

  const folders = visible.filter((section) => section.workspace !== undefined);
  const orphans = visible.filter((section) => section.workspace === undefined);

  const sorted =
    preferences.order === 'name'
      ? [...folders].sort((left, right) => left.title.localeCompare(right.title, locale))
      : [...folders].sort((left, right) => lastActivity(right) - lastActivity(left));

  return [...sorted, ...orphans];
}

export type FolderListState = 'folders' | 'all-hidden' | 'only-empty-hidden';

export interface FolderView {
  state: FolderListState;
  sections: FolderSection[];
}

export function folderListState(
  sections: readonly FolderSection[],
  preferences: FolderPreferences,
): FolderListState {
  const folders = sections.filter((section) => section.workspace !== undefined);
  if (folders.length === 0) return 'folders';

  const visible = folders.filter(
    (section) =>
      !preferences.hidden.includes(section.workspace!.id) &&
      !(preferences.hideEmpty && section.sessions.length === 0),
  );
  if (visible.length > 0) return 'folders';

  if (sections.some((section) => !section.workspace && section.sessions.length > 0)) {
    return 'folders';
  }

  const allHidden = folders.every((section) => preferences.hidden.includes(section.workspace!.id));
  return allHidden ? 'all-hidden' : 'only-empty-hidden';
}

export function folderView(
  sections: readonly FolderSection[],
  preferences: FolderPreferences,
  locale?: string,
): FolderView {
  const state = folderListState(sections, preferences);
  const effective =
    state === 'only-empty-hidden' ? { ...preferences, hideEmpty: false } : preferences;

  return { state, sections: applyFolderPreferences(sections, effective, locale) };
}
