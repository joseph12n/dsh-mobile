export const NAV_KEY = 'dshMobile';

export interface SessionEntry {
  view: 'session';
  id: string;
}

export interface SettingsEntry {
  view: 'settings';
}

export type NavEntry = SessionEntry | SettingsEntry;

export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  back(): void;
}

export function payloadOf(entry: NavEntry): Record<string, unknown> {
  return { [NAV_KEY]: entry };
}

export function entryOf(state: unknown): NavEntry | undefined {
  if (typeof state !== 'object' || state === null) return undefined;

  const candidate = (state as Record<string, unknown>)[NAV_KEY];
  if (typeof candidate !== 'object' || candidate === null) return undefined;

  const record = candidate as Record<string, unknown>;
  if (record.view === 'settings') return { view: 'settings' };
  if (record.view === 'session' && typeof record.id === 'string' && record.id.length > 0) {
    return { view: 'session', id: record.id };
  }

  return undefined;
}

export function pushEntry(history: HistoryLike, entry: NavEntry): void {
  history.pushState(payloadOf(entry), '');
}

export function topEntry(history: HistoryLike): NavEntry | undefined {
  return entryOf(history.state);
}

export function sameEntry(left: NavEntry | undefined, right: NavEntry): boolean {
  if (!left || left.view !== right.view) return false;
  if (left.view === 'session' && right.view === 'session') return left.id === right.id;
  return true;
}

export function backFrom(history: HistoryLike, entry: NavEntry): boolean {
  if (!sameEntry(topEntry(history), entry)) return false;
  history.back();
  return true;
}
