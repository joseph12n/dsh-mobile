import type { SessionSummary, Workspace } from '@dsh-mobile/protocol';

/**
 * Grouping the list by folder.
 *
 * The desktop groups sessions by Workspace: a registered directory with a title and its
 * own session list. The phone should read the same way, so the primary axis becomes the
 * folder and the state stays visible as a badge.
 *
 * Two shapes have to coexist:
 *
 *  - **With folders**: one section per workspace, sessions inside ordered by urgency.
 *  - **Without folders**: the old sections by state. A host that does not expose
 *    workspaces is still a valid host.
 *
 * Pure logic, injected order, no React: the interesting cases are the ones that are not
 * obvious — a session whose folder disappeared, a folder with nothing in it, and a
 * session with no folder at all.
 */

/** How urgent a session is. Lower comes first. */
function urgency(session: SessionSummary): number {
  if (session.pendingQuestions > 0) return 0;
  if (session.state === 'working') return 1;
  return 2;
}

/** Most urgent first, then most recent. */
export function byUrgency(a: SessionSummary, b: SessionSummary): number {
  const difference = urgency(a) - urgency(b);
  return difference !== 0 ? difference : b.updatedAt - a.updatedAt;
}

export interface FolderSection {
  /** `undefined` for the group that collects sessions with no known folder. */
  workspace?: Workspace;
  title: string;
  sessions: SessionSummary[];
}

/**
 * Groups sessions into folders.
 *
 * Rules, and the reason for each:
 *
 *  - The order of the folders is the host's order. It is the order the desktop shows.
 *  - A session whose `workspaceId` matches no folder lands in the trailing group rather
 *    than disappearing: a folder can be removed on the desktop while a session still
 *    points at it.
 *  - A folder with no sessions is **kept**. It is where new sessions would go, and hiding
 *    it makes the app look like it lost a folder.
 *  - The trailing group only appears when it has something in it.
 */
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

/**
 * The name to show for a folder.
 *
 * The desktop derives a display name when the stored title is empty, and the directory is
 * the honest source: it is what the user picked. The last segment is used because a full
 * path does not fit on a phone.
 */
export function displayTitle(workspace: Workspace): string {
  const title = workspace.title.trim();
  if (title) return title;

  const segments = workspace.directory.split(/[/\\]+/).filter(Boolean);
  return segments.at(-1) ?? workspace.directory;
}

/** `true` when the list should be grouped by folder at all. */
export function usesFolders(workspaces: readonly Workspace[]): boolean {
  return workspaces.length > 0;
}
