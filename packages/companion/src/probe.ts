import { log } from './log.js';
import {
  service,
  type HostContext,
  type HostSession,
  type ProjectionsService,
  type SessionsService,
} from './host-api.js';

/**
 * Spike de viabilidad (Fase 0).
 *
 * No intenta hacer el producto: intenta **averiguar qué es cierto en esta
 * máquina**. Cada comprobación registra lo que encontró o por qué no pudo, y
 * ninguna lanza hacia el host.
 */

export interface SessionFacts {
  id: string;
  messageCount: number | undefined;
  asOfSeq: number | undefined;
  projectionKeys: string[] | undefined;
  /** Valor crudo de la proyección `userQuestions`, para inspeccionar su forma. */
  pendingQuestions: unknown;
}

export interface ProbeReport {
  timestamp: string;
  services: Record<string, string>;
  sessionCount: number | undefined;
  sessions: SessionFacts[];
  /** Qué APIs de inyección de texto existen, por nombre. */
  injectionCandidates: Record<string, string>;
}

/** Describe un valor sin volcarlo entero. */
function describe(value: unknown): string {
  if (value === undefined) return 'ausente';
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'function') return 'función';
  if (type !== 'object') return type;
  const keys = Object.keys(value as object);
  return `objeto{${keys.slice(0, 12).join(', ')}}`;
}

/** Resumen legible de una forma desconocida: tipo, longitud y primeras claves. */
function summarize(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0];
    return `array(${value.length}) primer elemento: ${describe(first)}`;
  }
  return describe(value);
}

function sessionFacts(
  session: HostSession,
  projections: ProjectionsService | undefined,
): SessionFacts {
  const facts: SessionFacts = {
    id: session.id,
    messageCount: undefined,
    asOfSeq: undefined,
    projectionKeys: undefined,
    pendingQuestions: undefined,
  };

  try {
    facts.messageCount = session.deriveMessages?.().length;
  } catch (error) {
    log(`deriveMessages() falló en ${session.id}: ${String(error)}`);
  }

  if (projections) {
    try {
      const snapshot = projections.snapshot(session);
      facts.asOfSeq = snapshot.asOfSeq;
      facts.projectionKeys = Object.keys(snapshot.values);
      facts.pendingQuestions = snapshot.values['userQuestions'];
    } catch (error) {
      log(`snapshot() falló en ${session.id}: ${String(error)}`);
    }
  }

  return facts;
}

/**
 * Ejecuta las comprobaciones E0.1 (preguntas) y E0.2 (sesiones y transcripción)
 * y devuelve los hechos. No escribe nada en las sesiones.
 */
export function runProbe(ctx: HostContext): ProbeReport {
  const sessions = service<SessionsService>(ctx, 'sessions');
  const projections = service<ProjectionsService>(ctx, 'sessionProjections');
  const userQuestions = service<Record<string, unknown>>(ctx, 'userQuestions');

  const services: Record<string, string> = {
    sessions: describe(sessions),
    sessionProjections: describe(projections),
    commands: describe(service(ctx, 'commands')),
    userQuestions: describe(userQuestions),
    tools: describe(service(ctx, 'tools')),
    agents: describe(service(ctx, 'agents')),
    agent: describe(service(ctx, 'agent')),
  };

  let sessionCount: number | undefined;
  const facts: SessionFacts[] = [];

  if (sessions) {
    try {
      const list = sessions.list();
      sessionCount = list.length;
      for (const session of list.slice(0, 10)) {
        facts.push(sessionFacts(session, projections));
      }
    } catch (error) {
      log(`sessions.list() falló: ${String(error)}`);
    }
  }

  // E0.3: no sabemos dónde vive la inyección de texto; se reporta qué existe.
  const injectionCandidates: Record<string, string> = {
    'session.append': describe((sessions?.list() ?? [])[0]?.['append' as keyof HostSession]),
    'userQuestions.answer': describe(userQuestions?.['answer']),
    'ctx.agents': describe(service(ctx, 'agents')),
    'ctx.agent': describe(service(ctx, 'agent')),
    'ctx.prompt': describe(service(ctx, 'prompt')),
    'ctx.turns': describe(service(ctx, 'turns')),
  };

  return {
    timestamp: new Date().toISOString(),
    services,
    sessionCount,
    sessions: facts,
    injectionCandidates,
  };
}

/** Vuelca el informe al log de evidencia, línea por línea. */
export function reportToLog(report: ProbeReport): void {
  log('===== FASE 0: sondeo =====');
  log(`servicios: ${JSON.stringify(report.services)}`);
  log(`sesiones vivas: ${report.sessionCount ?? 'no disponible'}`);

  for (const session of report.sessions) {
    log(
      `- sesión ${session.id}: mensajes=${session.messageCount ?? '?'} ` +
        `asOfSeq=${session.asOfSeq ?? '?'} proyecciones=[${(session.projectionKeys ?? []).join(', ')}]`,
    );
    log(`  userQuestions -> ${summarize(session.pendingQuestions)}`);
  }

  log(`candidatos de inyección: ${JSON.stringify(report.injectionCandidates)}`);
  log('===== fin del sondeo =====');
}

/** Informe en texto, para devolverlo desde el comando. */
export function reportToText(report: ProbeReport): string {
  const lines: string[] = [];
  lines.push(`Sondeo Fase 0 — ${report.timestamp}`);
  lines.push(`Sesiones vivas: ${report.sessionCount ?? 'no disponible'}`);
  lines.push('');
  lines.push('Servicios:');
  for (const [key, value] of Object.entries(report.services)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('');
  lines.push('Sesiones:');
  for (const session of report.sessions) {
    lines.push(
      `  ${session.id} · mensajes=${session.messageCount ?? '?'} · asOfSeq=${session.asOfSeq ?? '?'}`,
    );
    lines.push(`    proyecciones: ${(session.projectionKeys ?? []).join(', ') || 'ninguna'}`);
    lines.push(`    userQuestions: ${summarize(session.pendingQuestions)}`);
  }
  lines.push('');
  lines.push('Candidatos de inyección de texto:');
  for (const [key, value] of Object.entries(report.injectionCandidates)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join('\n');
}
