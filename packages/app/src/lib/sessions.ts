import type { SessionSummary } from '@deepseekharness-mobile/protocol';

export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type SectionKind = 'waiting' | 'working' | 'idle' | 'stale';

export interface SessionSection {
  kind: SectionKind;
  sessions: SessionSummary[];
}

function waits(session: SessionSummary): boolean {
  return session.pendingQuestions > 0;
}

export function groupSessions(
  sessions: readonly SessionSummary[],
  now: number = Date.now(),
): SessionSection[] {
  const buckets: Record<SectionKind, SessionSummary[]> = {
    waiting: [],
    working: [],
    idle: [],
    stale: [],
  };

  for (const session of sessions) {
    if (waits(session)) {
      buckets.waiting.push(session);
      continue;
    }

    if (session.state === 'working') {
      buckets.working.push(session);
      continue;
    }

    const age = now - session.updatedAt;
    if (session.updatedAt > 0 && age >= STALE_AFTER_MS) buckets.stale.push(session);
    else buckets.idle.push(session);
  }

  const byRecency = (a: SessionSummary, b: SessionSummary): number => b.updatedAt - a.updatedAt;
  for (const list of Object.values(buckets)) list.sort(byRecency);

  return (['waiting', 'working', 'idle', 'stale'] as const)
    .filter((kind) => buckets[kind].length > 0)
    .map((kind) => ({ kind, sessions: buckets[kind] }));
}

export type Elapsed = { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; count: number };

export function elapsed(timestamp: number, now: number = Date.now()): Elapsed | undefined {
  if (!timestamp) return undefined;

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return { unit: 'now' };

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: 'minutes', count: minutes };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };

  return { unit: 'days', count: Math.floor(hours / 24) };
}
