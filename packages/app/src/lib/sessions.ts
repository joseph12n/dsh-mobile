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
  title: string;
  sessions: SessionSummary[];
}

const TITLES: Record<SectionKind, string> = {
  waiting: 'Esperando tu respuesta',
  working: 'Trabajando',
  idle: 'En reposo',
  stale: 'Más antiguas',
};

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
    .map((kind) => ({ kind, title: TITLES[kind], sessions: buckets[kind] }));
}

/** "hace 5 min", "hace 3 h", "hace 2 d". Vacío si no se conoce la fecha. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  if (!timestamp) return '';

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'ahora';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  return `hace ${Math.round(hours / 24)} d`;
}
