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

/** Cuántas llamadas a herramientas hay en un turno. */
export function toolsIn(turn: Turn): number {
  return turn.entries.filter((entry) => entry.event.kind === 'tool').length;
}

/**
 * Entradas de un turno que merecen verse siempre.
 *
 * Las herramientas se pliegan porque son muchas y ruidosas; los mensajes y los
 * cambios de estado no, porque son los que cuentan qué pasó.
 */
export function visibleEntries(turn: Turn): HistoryEntry[] {
  return turn.entries.filter((entry) => entry.event.kind !== 'tool');
}

/** Entradas de herramienta de un turno, para el grupo plegable. */
export function toolEntries(turn: Turn): HistoryEntry[] {
  return turn.entries.filter((entry) => entry.event.kind === 'tool');
}
