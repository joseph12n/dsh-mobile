import { z } from 'zod';

/** Identificador de una sesión de DSH. Opaque para el cliente. */
export const SessionId = z.string().min(1);
export type SessionId = z.infer<typeof SessionId>;

/** Identificador de una pregunta pendiente. */
export const QuestionId = z.string().min(1);
export type QuestionId = z.infer<typeof QuestionId>;

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
  id: z.string().min(1),
  label: z.string(),
  description: z.string().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

/**
 * Pregunta pendiente. `kind` distingue una selección normal de una aprobación
 * con forma fija (rechazar / permitir / permitir siempre).
 */
export const Question = z.object({
  id: QuestionId,
  sessionId: SessionId,
  kind: z.enum(['select', 'approval', 'text']),
  text: z.string(),
  /** Contexto adicional: el plan, el comando que se va a ejecutar, etc. */
  detail: z.string().optional(),
  options: z.array(QuestionOption),
  multiSelect: z.boolean(),
  /** Permite responder texto libre además de (o en vez de) las opciones. */
  allowCustom: z.boolean(),
  createdAt: z.number().int().nonnegative(),
});
export type Question = z.infer<typeof Question>;

/** Respuesta a una pregunta. `selected: []` sin `custom` significa omitida. */
export const QuestionAnswer = z.object({
  selected: z.array(z.string()),
  custom: z.string().optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

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
