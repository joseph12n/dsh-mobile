import { log } from './log.js';
import {
  methodNames,
  service,
  serviceNames,
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
 *
 * Lo que se busca, en orden:
 *  - E0.1 preguntas pendientes, vía la proyección `userQuestions`
 *  - E0.2 sesiones vivas y transcripción
 *  - E0.3 por dónde se inyecta texto: aquí se enumeran los servicios reales en
 *    lugar de adivinar nombres
 */

/** Servicios que podrían servir para leer o inyectar conversación. */
// `workspace` se incluye a proposito: el escritorio agrupa por workspace y el
// plugin necesita saber si ese servicio esta montado antes de prometer carpetas.
const RELEVANT_SERVICE =
  /agent|turn|prompt|input|inbox|rpc|session|question|tool|workspace|project/i;

export interface ServiceDetail {
  name: string;
  methods: string[];
}

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
  /** Nombres de todos los servicios montados, según el registro de cordis. */
  serviceNames: string[];
  /** Métodos de los servicios que podrían tocar la conversación. */
  serviceDetails: ServiceDetail[];
  services: Record<string, string>;
  sessionCount: number | undefined;
  sessions: SessionFacts[];
  /** Qué APIs candidatas existen, por nombre. */
  injectionCandidates: Record<string, string>;
}

/** Describe un valor sin volcarlo entero. */
function describe(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'function') return 'function';
  if (type !== 'object') return type;
  const keys = Object.keys(value as object);
  return `object{${keys.slice(0, 12).join(', ')}}`;
}

/** Resumen legible de una forma desconocida: tipo, longitud y primeras claves. */
function summarize(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(${value.length}) first element: ${describe(value[0])}`;
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
    log(`deriveMessages() failed on ${session.id}: ${String(error)}`);
  }

  if (projections) {
    try {
      const snapshot = projections.snapshot(session);
      facts.asOfSeq = snapshot.asOfSeq;
      facts.projectionKeys = Object.keys(snapshot.values);
      facts.pendingQuestions = snapshot.values['userQuestions'];
    } catch (error) {
      log(`snapshot() failed on ${session.id}: ${String(error)}`);
    }
  }

  return facts;
}

/**
 * Ejecuta las comprobaciones y devuelve los hechos. No escribe nada en las
 * sesiones: es un sondeo de lectura.
 */
export function runProbe(ctx: HostContext): ProbeReport {
  const sessions = service<SessionsService>(ctx, 'sessions');
  const projections = service<ProjectionsService>(ctx, 'sessionProjections');
  const userQuestions = service<Record<string, unknown>>(ctx, 'userQuestions');
  const firstSession = sessions?.list()[0];

  const names = serviceNames(ctx);
  const details: ServiceDetail[] = names
    .filter((name) => RELEVANT_SERVICE.test(name))
    .map((name) => ({ name, methods: methodNames(service(ctx, name)) }));

  const workspaceController = service<Record<string, unknown>>(ctx, 'workspaceController');

  const services: Record<string, string> = {
    sessions: describe(sessions),
    sessionProjections: describe(projections),
    commands: describe(service(ctx, 'commands')),
    userQuestions: describe(userQuestions),
    tools: describe(service(ctx, 'tools')),
    // Si existe, el escritorio agrupa por carpeta y el plugin puede hacer lo mismo.
    workspaceController: describe(workspaceController),
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
      log(`sessions.list() failed: ${String(error)}`);
    }
  }

  // E0.3: qué hay disponible para meter texto en una sesión.
  const sessionController = service<Record<string, unknown>>(ctx, 'sessionController');
  const injectionCandidates: Record<string, string> = {
    sessionController: describe(sessionController),
    'sessionController.prompt': describe(sessionController?.['prompt']),
    'session.append': describe(firstSession?.['append' as keyof HostSession]),
    'userQuestions.answer': describe(userQuestions?.['answer']),
    'ctx.agents': describe(service(ctx, 'agents')),
    'ctx.agentLoop': describe(service(ctx, 'agentLoop')),
  };

  return {
    timestamp: new Date().toISOString(),
    serviceNames: names,
    serviceDetails: details,
    services,
    sessionCount,
    sessions: facts,
    injectionCandidates,
  };
}

/** Vuelca el informe al log de evidencia, línea por línea. */
export function reportToLog(report: ProbeReport): void {
  log('===== PHASE 0: probe =====');
  log(`mounted services (${report.serviceNames.length}): ${report.serviceNames.join(', ')}`);

  for (const detail of report.serviceDetails) {
    log(`  · ${detail.name}: ${detail.methods.join(', ') || '(no enumerable methods)'}`);
  }

  log(`live sessions: ${report.sessionCount ?? 'not available'}`);

  for (const session of report.sessions) {
    log(
      `- session ${session.id}: messages=${session.messageCount ?? '?'} ` +
        `asOfSeq=${session.asOfSeq ?? '?'} projections=${session.projectionKeys?.length ?? 0}`,
    );
    log(`  userQuestions -> ${summarize(session.pendingQuestions)}`);
  }

  log(`injection candidates: ${JSON.stringify(report.injectionCandidates)}`);
  log('===== end of probe =====');
}

/** Informe en texto, para devolverlo desde el comando. */
export function reportToText(report: ProbeReport): string {
  const lines: string[] = [];
  lines.push(`Phase 0 probe — ${report.timestamp}`);
  lines.push(`Live sessions: ${report.sessionCount ?? 'not available'}`);
  lines.push(`Mounted services: ${report.serviceNames.length}`);
  lines.push('');

  for (const [index, session] of report.sessions.entries()) {
    lines.push(`${index + 1}) ${session.id}`);
    lines.push(`   messages=${session.messageCount ?? '?'} · asOfSeq=${session.asOfSeq ?? '?'}`);
    lines.push(`   userQuestions: ${summarize(session.pendingQuestions)}`);
  }

  lines.push('');
  lines.push('Services related to the conversation:');
  for (const detail of report.serviceDetails) {
    lines.push(`  ${detail.name}: ${detail.methods.join(', ') || '(no enumerable methods)'}`);
  }

  lines.push('');
  lines.push('Text injection candidates:');
  for (const [key, value] of Object.entries(report.injectionCandidates)) {
    lines.push(`  ${key}: ${value}`);
  }

  if (report.sessions.length > 0) {
    lines.push('');
    lines.push('To inject into one: /mobile-say <number> <text>');
  }

  return lines.join('\n');
}
