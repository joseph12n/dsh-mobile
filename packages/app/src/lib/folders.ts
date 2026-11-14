import type { SessionSummary, Workspace } from '@deepseekharness-mobile/protocol';

function urgency(session: SessionSummary): number {
  if (session.pendingQuestions > 0) return 0;
  if (session.state === 'working') return 1;
  return 2;
}

export function byUrgency(a: SessionSummary, b: SessionSummary): number {
  const difference = urgency(a) - urgency(b);
  return difference !== 0 ? difference : b.updatedAt - a.updatedAt;
}

export interface FolderSection {
  workspace?: Workspace;
  title: string;
  sessions: SessionSummary[];
}

export function groupByFolder(
  sessions: readonly SessionSummary[],
  workspaces: readonly Workspace[],
): FolderSection[] {
  if (workspaces.length === 0) return [];

  const byId = new Map<string, SessionSummary[]>();
  const orphans: SessionSummary[] = [];

  for (const session of sessions) {
    const folder = session.workspaceId;
    const known = folder ? workspaces.some((workspace) => workspace.id === folder) : false;

    if (!folder || !known) {
      orphans.push(session);
      continue;
    }

    const list = byId.get(folder) ?? [];
    list.push(session);
    byId.set(folder, list);
  }

  const sections: FolderSection[] = workspaces.map((workspace) => ({
    workspace,
    title: displayTitle(workspace),
    sessions: (byId.get(workspace.id) ?? []).sort(byUrgency),
  }));

  if (orphans.length > 0) {
    sections.push({ title: '', sessions: [...orphans].sort(byUrgency) });
  }

  return sections;
}

export function displayTitle(workspace: Workspace): string {
  const title = workspace.title.trim();
  if (title) return title;

  const segments = workspace.directory.split(/[/\\]+/).filter(Boolean);
  return segments.at(-1) ?? workspace.directory;
}

export function usesFolders(workspaces: readonly Workspace[]): boolean {
  return workspaces.length > 0;
}

const FOLDER_ACCENTS = [
  '#7dd3c0',
  '#93b4f5',
  '#c9a3f0',
  '#e6be78',
  '#86d69a',
  '#e79ab0',
  '#f0a58f',
  '#a7c7d9',
] as const;

export function folderAccent(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return FOLDER_ACCENTS[hash % FOLDER_ACCENTS.length] ?? FOLDER_ACCENTS[0];
}

export function parentPath(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));

  if (cut < 0) return '';
  if (cut === 0) return trimmed.startsWith('/') ? '/' : '';

  const parent = trimmed.slice(0, cut);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

export function compactPath(path: string, keep = 2): string {
  if (!path) return '';

  const separator = path.includes('\\') ? '\\' : '/';
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.length <= keep) return path;

  return `…${separator}${segments.slice(-keep).join(separator)}`;
}
