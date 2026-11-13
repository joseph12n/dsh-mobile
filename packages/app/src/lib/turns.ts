import type { HistoryEntry } from '@dsh-mobile/protocol';

export interface Turn {
  id: number;
  prompt?: string | undefined;
  at: number;
  entries: HistoryEntry[];
}

function opensTurn(entry: HistoryEntry): boolean {
  return entry.event.kind === 'message' && entry.event.role === 'user';
}

export function groupTurns(entries: readonly HistoryEntry[]): Turn[] {
  const turns: Turn[] = [];

  for (const entry of entries) {
    const current = turns.at(-1);
    const mustOpen = opensTurn(entry) || current === undefined;

    if (mustOpen) {
      turns.push({
        id: entry.seq,
        at: entry.at,
        prompt: opensTurn(entry) ? (entry.event as { text: string }).text : undefined,
        entries: [entry],
      });
      continue;
    }

    current.entries.push(entry);
  }

  return turns;
}

export type TurnPart =
  { kind: 'entry'; entry: HistoryEntry } | { kind: 'tools'; entries: HistoryEntry[] };

export function partTurn(entries: readonly HistoryEntry[]): TurnPart[] {
  const parts: TurnPart[] = [];

  for (const entry of entries) {
    if (entry.event.kind !== 'tool') {
      parts.push({ kind: 'entry', entry });
      continue;
    }

    const last = parts.at(-1);
    if (last?.kind === 'tools') last.entries.push(entry);
    else parts.push({ kind: 'tools', entries: [entry] });
  }

  return parts;
}
