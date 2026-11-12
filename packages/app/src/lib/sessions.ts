import type { SessionSummary } from '@dsh-mobile/protocol';

/**
 * Agrupación de sesiones para la lista.
 *
 * El objetivo es que al coger el teléfono se vea **sin abrir nada** qué requiere
 * tu atención. Por eso las secciones están en orden de urgencia y no de fecha:
 * una sesión esperando respuesta importa más que una que lleva dos horas quieta.
 *
 * Es lógica pura con el reloj inyectado, así que se prueba sin esperar.
 */

/** A partir de aquí, una sesión en reposo pasa al grupo plegable. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type SectionKind = 'waiting' | 'working' | 'idle' | 'stale';

export interface SessionSection {
  kind: SectionKind;
  sessions: SessionSummary[];
}

/** `true` si la sesión espera algo del humano. */
function waits(session: SessionSummary): boolean {
  return session.pendingQuestions > 0;
}

/**
 * Agrupa por estado. El orden de las secciones es fijo y refleja urgencia.
 *
 * Una sesión que espera respuesta cuenta como tal aunque además esté
 * trabajando: lo pendiente es lo que bloquea al agente.
 */
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
    // `updatedAt` en 0 significa desconocido: no se esconde por antigüedad.
    if (session.updatedAt > 0 && age >= STALE_AFTER_MS) buckets.stale.push(session);
    else buckets.idle.push(session);
  }

  // Dentro de cada sección, lo más reciente primero.
  const byRecency = (a: SessionSummary, b: SessionSummary): number => b.updatedAt - a.updatedAt;
  for (const list of Object.values(buckets)) list.sort(byRecency);

  return (['waiting', 'working', 'idle', 'stale'] as const)
    .filter((kind) => buckets[kind].length > 0)
    .map((kind) => ({ kind, sessions: buckets[kind] }));
}

/**
 * Elapsed time as data, not as text.
 *
 * It used to return a Spanish sentence. Language belongs to the view, so this
 * returns the unit and the amount and the catalogue turns it into words.
 *
 * It truncates instead of rounding: saying "7 d" at 6.5 days contradicted the
 * folder that session was still in.
 */
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
