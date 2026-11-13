import { describe, expect, it } from 'vitest';
import type { HistoryEntry, TranscriptEvent } from '@dsh-mobile/protocol';
import { groupTurns, partTurn } from './turns.js';

let seq = 0;

function entry(event: TranscriptEvent): HistoryEntry {
  seq += 1;
  return { seq, at: 1_800_000_000_000 + seq * 1000, event };
}

const user = (text: string): TranscriptEvent => ({ kind: 'message', role: 'user', text });
const agent = (text: string): TranscriptEvent => ({ kind: 'message', role: 'assistant', text });
const tool = (name: string): TranscriptEvent => ({
  kind: 'tool',
  name,
  summary: `${name} hizo algo`,
  status: 'ok',
});
const state = (value: 'working' | 'idle'): TranscriptEvent => ({ kind: 'state', state: value });

describe('agrupación en turnos', () => {
  it('abre un turno con cada mensaje del humano', () => {
    const turns = groupTurns([entry(user('uno')), entry(agent('a')), entry(user('dos'))]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.prompt).toBe('uno');
    expect(turns[1]?.prompt).toBe('dos');
  });

  it('mete la respuesta del agente en el turno de su pregunta', () => {
    const turns = groupTurns([entry(user('pregunta')), entry(agent('respuesta'))]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.entries).toHaveLength(2);
  });

  it('lo anterior al primer mensaje no se atribuye al primer turno', () => {
    const turns = groupTurns([entry(state('idle')), entry(user('hola'))]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.prompt).toBeUndefined();
    expect(turns[1]?.prompt).toBe('hola');
  });

  it('un cambio de estado no abre turno aunque llegue en medio', () => {
    const turns = groupTurns([entry(user('uno')), entry(state('working')), entry(agent('fin'))]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.entries).toHaveLength(3);
  });

  it('identifica cada turno por el seq que lo abre', () => {
    const first = entry(user('uno'));
    const turns = groupTurns([first, entry(user('dos'))]);
    expect(turns[0]?.id).toBe(first.seq);
  });

  it('con la lista vacía no devuelve turnos', () => {
    expect(groupTurns([])).toEqual([]);
  });

  it('no muta las entradas de origen', () => {
    const entries = [entry(user('uno')), entry(tool('leer'))];
    const before = structuredClone(entries);
    groupTurns(entries);
    expect(entries).toEqual(before);
  });
});

describe('orden dentro del turno', () => {
  it('una herramienta entre dos mensajes se queda entre ellos', () => {
    const [turn] = groupTurns([
      entry(user('pregunta')),
      entry(tool('leer')),
      entry(agent('respuesta')),
    ]);

    const kinds = partTurn(turn!.entries).map((part) =>
      part.kind === 'entry'
        ? `${part.entry.event.kind}:${'role' in part.entry.event ? part.entry.event.role : ''}`
        : `tools:${part.entries.length}`,
    );

    expect(kinds).toEqual(['message:user', 'tools:1', 'message:assistant']);
  });

  it('junta las herramientas consecutivas en un solo trozo', () => {
    const [turn] = groupTurns([
      entry(user('uno')),
      entry(tool('a')),
      entry(tool('b')),
      entry(tool('c')),
      entry(agent('fin')),
    ]);

    const parts = partTurn(turn!.entries);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toEqual({ kind: 'tools', entries: expect.any(Array) });
    expect((parts[1] as { entries: unknown[] }).entries).toHaveLength(3);
  });

  it('dos rachas separadas no se mezclan', () => {
    const [turn] = groupTurns([
      entry(user('uno')),
      entry(tool('a')),
      entry(agent('medio')),
      entry(tool('b')),
    ]);

    const parts = partTurn(turn!.entries);
    expect(parts.map((part) => part.kind)).toEqual(['entry', 'tools', 'entry', 'tools']);
  });

  it('no pierde ninguna entrada al partir', () => {
    const entries = [
      entry(user('uno')),
      entry(tool('a')),
      entry(agent('x')),
      entry(tool('b')),
      entry(state('idle')),
    ];
    const [turn] = groupTurns(entries);
    const total = partTurn(turn!.entries).reduce(
      (count, part) => count + (part.kind === 'tools' ? part.entries.length : 1),
      0,
    );
    expect(total).toBe(entries.length);
  });
});

describe('casos raros de agrupación', () => {
  it('dos mensajes del humano seguidos abren dos turnos', () => {
    const turns = groupTurns([entry(user('uno')), entry(user('dos'))]);
    expect(turns.map((turn) => turn.prompt)).toEqual(['uno', 'dos']);
  });

  it('una sesión sin mensajes del humano es un turno sin pregunta', () => {
    const turns = groupTurns([entry(state('working')), entry(tool('leer'))]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.prompt).toBeUndefined();
  });
});
