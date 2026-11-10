import { z } from 'zod';
import { envelopeFields } from './envelope.js';
import { ErrorCode } from './errors.js';
import {
  Capability,
  DeviceInfo,
  HostInfo,
  QuestionAnswerItem,
  QuestionBatch,
  SessionId,
  SessionState,
  SessionSummary,
  TranscriptEvent,
} from './domain.js';

/** Compone un mensaje: sobre + `type` literal + campos propios. */
function message<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ ...envelopeFields, type: z.literal(type), ...shape });
}

/** Entrada de historial: el evento más el cursor que lo sitúa. */
export const HistoryEntry = z.object({
  seq: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
  event: TranscriptEvent,
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

// ---------------------------------------------------------------------------
// Cliente → Host
// ---------------------------------------------------------------------------

/**
 * Debe ser el primer mensaje. Sin él, cualquier otra petición se rechaza con
 * `auth-required`.
 */
export const HelloMessage = message('hello', {
  proto: z.number().int().positive(),
  /** Ausente durante el emparejamiento. */
  deviceToken: z.string().min(1).optional(),
  clientName: z.string().optional(),
});

/** Canjea un código de un solo uso por un token de dispositivo. */
export const PairRedeemMessage = message('pair.redeem', {
  code: z.string().min(1),
  deviceName: z.string().min(1).max(64),
  platform: z.string().max(64),
});

export const SessionsListMessage = message('sessions.list', {});

export const SessionSubscribeMessage = message('session.subscribe', {
  sessionId: SessionId,
  /** Cursor: el cliente pide lo posterior a este `seq`. */
  since: z.number().int().nonnegative().optional(),
});

export const SessionHistoryMessage = message('session.history', {
  sessionId: SessionId,
  before: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const ReplySendMessage = message('reply.send', {
  sessionId: SessionId,
  text: z.string().min(1).max(32_000),
});

/**
 * Responde un lote completo. DSH valida que cada pregunta del lote aparezca
 * **exactamente una vez**, así que no se puede contestar de una en una.
 */
export const QuestionAnswerMessage = message('question.answer', {
  callId: z.string().min(1),
  sessionId: SessionId,
  answers: z.array(QuestionAnswerItem).min(1),
});

export const RunStartMessage = message('run.start', {
  sessionId: SessionId,
  prompt: z.string().min(1).max(32_000),
});

export const RunCancelMessage = message('run.cancel', {
  sessionId: SessionId,
});

export const PingMessage = message('ping', {});

export const ClientMessage = z.discriminatedUnion('type', [
  HelloMessage,
  PairRedeemMessage,
  SessionsListMessage,
  SessionSubscribeMessage,
  SessionHistoryMessage,
  ReplySendMessage,
  QuestionAnswerMessage,
  RunStartMessage,
  RunCancelMessage,
  PingMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageType = ClientMessage['type'];

// ---------------------------------------------------------------------------
// Host → Cliente
// ---------------------------------------------------------------------------

export const PongMessage = message('pong', {});

export const HelloOkMessage = message('hello.ok', {
  host: HostInfo,
  /** Ausente mientras el cliente no está emparejado: `pair.ok` lo entrega. */
  device: DeviceInfo.optional(),
});

export const PairOkMessage = message('pair.ok', {
  deviceToken: z.string().min(1),
  host: HostInfo,
  device: DeviceInfo,
});

export const SessionsOkMessage = message('sessions.ok', {
  sessions: z.array(SessionSummary),
});

export const SessionOkMessage = message('session.ok', {
  sessionId: SessionId,
  seq: z.number().int().nonnegative(),
});

export const HistoryOkMessage = message('history.ok', {
  sessionId: SessionId,
  entries: z.array(HistoryEntry),
  /** `true` si hay más hacia atrás. */
  hasMore: z.boolean(),
});

export const ReplyOkMessage = message('reply.ok', {
  sessionId: SessionId,
  seq: z.number().int().nonnegative(),
});

export const AnswerOkMessage = message('answer.ok', {
  callId: z.string().min(1),
});

export const RunOkMessage = message('run.ok', {
  sessionId: SessionId,
  state: SessionState,
});

/** Evento de transcripción empujado por el host. */
export const SessionEventMessage = message('session.event', {
  sessionId: SessionId,
  seq: z.number().int().nonnegative(),
  event: TranscriptEvent,
});

export const SessionStateMessage = message('session.state', {
  sessionId: SessionId,
  state: SessionState,
  seq: z.number().int().nonnegative(),
});

export const QuestionPendingMessage = message('question.pending', {
  question: QuestionBatch,
});

/**
 * El lote dejó de estar pendiente. O lo respondió este cliente, o lo resolvió el
 * escritorio: en ambos casos el móvil deja de ofrecerlo.
 */
export const QuestionSettledMessage = message('question.settled', {
  callId: z.string().min(1),
  sessionId: SessionId,
  answers: z.array(QuestionAnswerItem).optional(),
});

export const DevicesChangedMessage = message('devices.changed', {
  devices: z.array(DeviceInfo),
});

/**
 * Error de una petición. Reusa el `id` de la petición que falló. Lleva
 * `capabilities` cuando lo que falla es la negociación, para que el cliente
 * pueda decir qué versión soporta el host.
 */
export const ErrorMessage = message('error', {
  code: ErrorCode,
  message: z.string(),
  capabilities: z.array(Capability).optional(),
});

export const ServerMessage = z.discriminatedUnion('type', [
  PongMessage,
  HelloOkMessage,
  PairOkMessage,
  SessionsOkMessage,
  SessionOkMessage,
  HistoryOkMessage,
  ReplyOkMessage,
  AnswerOkMessage,
  RunOkMessage,
  SessionEventMessage,
  SessionStateMessage,
  QuestionPendingMessage,
  QuestionSettledMessage,
  DevicesChangedMessage,
  ErrorMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageType = ServerMessage['type'];
