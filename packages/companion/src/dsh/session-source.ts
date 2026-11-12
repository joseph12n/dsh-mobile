/**
 * Adaptador de lectura de sesiones.
 *
 * No reimplementa la lógica del escritorio: delega en `ctx.sessionController`,
 * que es el mismo servicio que alimenta la lista de la UI de DSH. Así el móvil y
 * el escritorio no pueden discrepar sobre qué sesiones existen ni cuándo
 * cambiaron.
 *
 * Las preguntas pendientes sí se leen de la proyección `userQuestions`, porque el
 * resumen no las trae.
 */
import type {
  ModelSelection,
  SessionState as WireState,
  SessionSummary as WireSession,
} from '@dsh-mobile/protocol';
import {
  service,
  type HostContext,
  type ProjectionsService,
  type SessionsService,
} from '../host-api.js';
import { listArchivedSessions, listWorkspaces } from './workspaces.js';
import { selectionOf } from './models.js';

/** Una entrada del registro de sesiones, tal como la ve el móvil. */
export interface SessionRecord {
  id: string;
  title: string;
  updatedAt: number;
  seq: number;
  /** Agente vivo en memoria para esta sesión. */
  agentAvailable: boolean;
  /** Hay un turno en curso. */
  running: boolean;
  pendingQuestions: number;
  /** Folder that contains it, when the host exposes workspaces. */
  workspaceId?: string;
  /** Modelo con el que seguirá la sesión, si el host lo proyecta. */
  model?: ModelSelection;
  /** `true` cuando la lista se pidió con las archivadas y esta lo está. */
  archived?: boolean;
}

/** Resumen que devuelve `sessionController.list()`. Subconjunto de lo que usamos. */
interface ControllerSummary {
  sessionId?: string;
  updatedAt?: number;
  running?: boolean;
  blank?: boolean;
  agentAvailable?: boolean;
  projections?: {
    asOfSeq?: number;
    values?: Record<string, unknown>;
  };
}

interface SessionListController {
  list(
    request: { cursor?: string },
    signal: AbortSignal,
  ): Promise<{ items?: readonly ControllerSummary[] }>;
}

const MAX_SESSIONS = 200;

/** Cuenta preguntas abiertas en la proyección `userQuestions`. */
function countPending(snapshot: unknown): number {
  if (typeof snapshot !== 'object' || snapshot === null) return 0;
  const active = (snapshot as { active?: unknown }).active;
  return Array.isArray(active) ? active.length : 0;
}

/** Lee las preguntas pendientes de una sesión viva; 0 si no se puede. */
function pendingFor(
  ctx: HostContext,
  sessionId: string,
  projections: ProjectionsService | undefined,
): number {
  if (!projections) return 0;
  const sessions = service<SessionsService>(ctx, 'sessions');
  const session = sessions?.get(sessionId);
  if (!session) return 0;

  try {
    return countPending(projections.snapshot(session).values['userQuestions']);
  } catch {
    return 0;
  }
}

/** Lee el modelo vigente de la proyección `modelSelection`. */
function modelFor(item: ControllerSummary): ModelSelection | undefined {
  const snapshot = item.projections?.values?.['modelSelection'];
  if (typeof snapshot !== 'object' || snapshot === null) return undefined;
  const record = snapshot as Record<string, unknown>;

  // La vista de la proyección es `{ lastUsed, next }`: `next` es lo que se aplicará
  // al próximo turno, que es justo lo que el usuario acaba de elegir.
  return selectionOf(record['next']) ?? selectionOf(record['lastUsed']) ?? selectionOf(record);
}

/** Traduce el estado del controlador a nuestro vocabulario, sin inventarlo. */
function wireState(record: SessionRecord): WireState {
  if (record.pendingQuestions > 0) return 'waiting';
  if (record.running) return 'working';
  return 'idle';
}

/**
 * Lista las sesiones.
 *
 * Devuelve `[]` si el host no expone `sessionController`: un móvil sin lista es
 * un problema, pero un plugin que revienta es peor.
 */
export async function listSessions(
  ctx: HostContext,
  options: { includeArchived?: boolean } = {},
): Promise<SessionRecord[]> {
  const controller = service<SessionListController>(ctx, 'sessionController');
  if (!controller || typeof controller.list !== 'function') return [];

  const projections = service<ProjectionsService>(ctx, 'sessionProjections');

  let items: readonly ControllerSummary[];
  try {
    const result = await controller.list({}, new AbortController().signal);
    items = result?.items ?? [];
  } catch {
    return [];
  }

  const records: SessionRecord[] = items
    .slice(0, MAX_SESSIONS)
    .map((item) => {
      const id = typeof item.sessionId === 'string' ? item.sessionId : '';
      const titleValue = item.projections?.values?.['title'];
      const pendingQuestions = id ? pendingFor(ctx, id, projections) : 0;
      const model = id ? modelFor(item) : undefined;

      return {
        id,
        title: typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : 'Untitled',
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
        seq: typeof item.projections?.asOfSeq === 'number' ? item.projections.asOfSeq : 0,
        agentAvailable: item.agentAvailable === true,
        running: item.running === true,
        pendingQuestions,
        ...(model ? { model } : {}),
      };
    })
    .filter((record) => record.id !== '');

  // Carpeta de cada sesión. El host guarda la pertenencia en la proyección de
  // workspaces, no en el resumen de la sesión, así que hay que cruzarla. Un fallo
  // aquí deja la lista plana, nunca la rompe.
  try {
    const workspaces = await listWorkspaces(ctx);
    const folderOf = new Map<string, string>();
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) folderOf.set(sessionId, workspace.id);
    }
    for (const record of records) {
      const folder = folderOf.get(record.id);
      if (folder) record.workspaceId = folder;
    }
  } catch {
    // Sin carpetas, la lista plana es la respuesta correcta.
  }

  // Archivadas: el host mantiene la fila y solo marca el id, así que sin esto archivar
  // desde el teléfono parecía no hacer nada. Se piden aparte y un fallo no esconde nada.
  const archived = await listArchivedSessions(ctx).catch(() => new Set<string>());

  // Con `includeArchived` se devuelven marcadas en vez de quitarlas: la vista de
  // archivadas necesita saber cuáles lo están para ofrecer restaurarlas.
  const visible =
    options.includeArchived === true
      ? records.map((record) => (archived.has(record.id) ? { ...record, archived: true } : record))
      : records.filter((record) => !archived.has(record.id));

  // Lo más reciente primero: es lo que uno mira al coger el teléfono.
  return visible.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Convierte un registro interno en el mensaje del contrato. */
export function toWireSession(record: SessionRecord): WireSession {
  return {
    id: record.id,
    title: record.title,
    state: wireState(record),
    updatedAt: record.updatedAt,
    seq: record.seq,
    pendingQuestions: record.pendingQuestions,
    // Se omite, never empty: el contrato acepta cualquier cadena, pero un `''` no es un id.
    ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(record.archived ? { archived: true } : {}),
  };
}
