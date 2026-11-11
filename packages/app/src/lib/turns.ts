import type { HistoryEntry } from '@dsh-mobile/protocol';

/**
 * Agrupación de la transcripción en turnos.
 *
 * Un turno empieza cuando habla el humano y termina cuando vuelve a hablar. Todo
 * lo que hay en medio —respuestas del agente, llamadas a herramientas, cambios de
 * estado— pertenece a ese turno. Así el detalle se lee de arriba abajo sin tener
 * que reconstruir mentalmente qué provocó qué.
 *
 * Es lógica pura: se prueba sin navegador ni reloj.
 */

export interface Turn {
  /** `seq` de la entrada que abre el turno; sirve de clave estable. */
  id: number;
  /** Lo que pidió el humano. Ausente en el turno inicial. */
  prompt?: string | undefined;
  /** Instante de la primera entrada del turno. */
  at: number;
  entries: HistoryEntry[];
}

/** `true` si la entrada abre un turno nuevo. */
function opensTurn(entry: HistoryEntry): boolean {
  return entry.event.kind === 'message' && entry.event.role === 'user';
}

/**
 * Parte las entradas en turnos.
 *
 * Lo que llega **antes** del primer mensaje del humano forma un turno sin
 * petición: son eventos de estado o arranques de sesión que no pertenecen a
 * ninguna pregunta y no deberían atribuirse a la siguiente.
 */
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

/** Un trozo del turno: una entrada visible, o una racha de herramientas. */
export type TurnPart =
  { kind: 'entry'; entry: HistoryEntry } | { kind: 'tools'; entries: HistoryEntry[] };

/**
 * Parte un turno en trozos **conservando el orden cronológico**.
 *
 * Las herramientas consecutivas se agrupan en el sitio donde ocurrieron. Antes se
 * sacaban al final del turno, y al desplegarlas aparecían después de una respuesta
 * que en realidad había llegado más tarde. En una traza eso se lee al revés.
 */
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
