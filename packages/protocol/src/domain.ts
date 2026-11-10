import { z } from 'zod';

/** Identificador de una sesión de DSH. Opaque para el cliente. */
export const SessionId = z.string().min(1);
export type SessionId = z.infer<typeof SessionId>;

/**
 * Estado visible de una sesión. Es una reducción deliberada: el móvil es un
 * mando, no necesita el ciclo de vida completo del agente.
 */
export const SessionState = z.enum(['idle', 'working', 'waiting', 'done', 'error']);
export type SessionState = z.infer<typeof SessionState>;

/**
 * Lo que este host puede hacer. El cliente oculta lo que no aparezca aquí, de
 * modo que un plugin viejo no rompe una PWA nueva.
 */
export const Capability = z.enum([
  'session.history',
  'reply.send',
  'question.answer',
  'run.start',
  'run.cancel',
]);
export type Capability = z.infer<typeof Capability>;

/** Fila de la lista de sesiones. */
export const SessionSummary = z.object({
  id: SessionId,
  title: z.string(),
  state: SessionState,
  updatedAt: z.number().int().nonnegative(),
  /** Último `seq` conocido. El cliente lo usa como cursor. */
  seq: z.number().int().nonnegative(),
  /** Preguntas sin responder en esta sesión. */
  pendingQuestions: z.number().int().nonnegative(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** Fragmento de transcripción. */
export const TranscriptEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    role: z.enum(['user', 'assistant']),
    text: z.string(),
  }),
  z.object({
    kind: z.literal('tool'),
    name: z.string(),
    summary: z.string(),
    status: z.enum(['running', 'ok', 'error']),
  }),
  z.object({
    kind: z.literal('state'),
    state: SessionState,
  }),
]);
export type TranscriptEvent = z.infer<typeof TranscriptEvent>;

/** Opción seleccionable de una pregunta. */
export const QuestionOption = z.object({
  label: z.string(),
  description: z.string().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

/**
 * Una pregunta dentro de un lote.
 *
 * DSH agrupa las preguntas de una misma llamada a `ask_user_question`: la
 * respuesta se valida por lote, así que el cliente tiene que contestar **todas**
 * las preguntas juntas. Modelarlo de uno en uno solo produce rechazos.
 */
export const QuestionItem = z.object({
  id: z.string().min(1),
  /** El texto que se muestra. */
  text: z.string(),
  /** Contexto adicional: el plan, el comando, el diff… */
  detail: z.string().optional(),
  /** Encabezado corto, cuando la pregunta lo trae. */
  header: z.string().optional(),
  options: z.array(QuestionOption),
  multiSelect: z.boolean(),
  /** `true` si el lote admite texto libre además de las opciones. */
  allowCustom: z.boolean(),
});
export type QuestionItem = z.infer<typeof QuestionItem>;

/** Estado de un lote: abierto, o continuado (solo puede responderse en un turno nuevo). */
export const QuestionState = z.enum(['open', 'continued']);
export type QuestionState = z.infer<typeof QuestionState>;

/**
 * Un lote de preguntas pendientes.
 *
 * `callId` es la identidad con la que se responde: la respuesta nombra el lote,
 * no cada pregunta por separado.
 */
export const QuestionBatch = z.object({
  callId: z.string().min(1),
  sessionId: SessionId,
  state: QuestionState,
  items: z.array(QuestionItem),
  createdAt: z.number().int().nonnegative(),
});
export type QuestionBatch = z.infer<typeof QuestionBatch>;

/**
 * Respuesta a una pregunta del lote.
 *
 * `selected: []` sin `custom` significa **omitida**, y es una respuesta
 * legítima. No es lo mismo que no responder.
 */
export const QuestionAnswerItem = z.object({
  id: z.string().min(1),
  selected: z.array(z.string()),
  custom: z.string().optional(),
});
export type QuestionAnswerItem = z.infer<typeof QuestionAnswerItem>;

/** Datos del host que el cliente muestra en el emparejamiento. */
export const HostInfo = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  capabilities: z.array(Capability),
});
export type HostInfo = z.infer<typeof HostInfo>;

/** Dispositivo emparejado, para la pantalla de gestión. */
export const DeviceInfo = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;
