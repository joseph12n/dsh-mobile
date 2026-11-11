import { describe, expect, it } from 'vitest';
import type { HistoryEntry, TranscriptEvent } from '@dsh-mobile/protocol';
import { groupTurns, toolEntries, toolsIn, visibleEntries } from './turns.js';

/**
 * Un turno es lo que pidió el humano y todo lo que provocó. El detalle de la
 * sesión se lee por turnos para no tener que reconstruir qué causó qué.
 */

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

  it('las herramientas pertenecen al turno en el que ocurrieron', () => {
    const turns = groupTurns([
      entry(user('uno')),
      entry(tool('leer')),
      entry(tool('escribir')),
      entry(user('dos')),
      entry(tool('buscar')),
    ]);

    expect(toolsIn(turns[0]!)).toBe(2);
    expect(toolsIn(turns[1]!)).toBe(1);
  });

  it('lo anterior al primer mensaje no se atribuye al primer turno', () => {
    // Un evento de estado al arrancar la sesión no lo pidió nadie.
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

describe('visibilidad dentro de un turno', () => {
  it('pliega las herramientas pero no los mensajes ni los estados', () => {
    const [turn] = groupTurns([
      entry(user('uno')),
      entry(tool('leer')),
      entry(agent('listo')),
      entry(state('idle')),
    ]);

    expect(visibleEntries(turn!).map((item) => item.event.kind)).toEqual([
      'message',
      'message',
      'state',
    ]);
    expect(toolEntries(turn!).map((item) => item.event.kind)).toEqual(['tool']);
  });
});
