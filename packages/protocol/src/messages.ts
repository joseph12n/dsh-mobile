import { z } from 'zod';
import { envelopeFields } from './envelope.js';
import { ErrorCode } from './errors.js';
import {
  Capabilities,
  CommandInfo,
  CommandResult,
  DeviceInfo,
  HostInfo,
  ModelCatalog,
  ModelSelection,
  QuestionAnswerItem,
  QuestionBatch,
  SessionId,
  SessionState,
  SessionSummary,
  Workspace,
  TranscriptEvent,
} from './domain.js';

function message<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ ...envelopeFields, type: z.literal(type), ...shape });
}

export const HistoryEntry = z.object({
  seq: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
  event: TranscriptEvent,
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const HelloMessage = message('hello', {
  proto: z.number().int().positive(),
  deviceToken: z.string().min(1).optional(),
  clientName: z.string().optional(),
});

export const PairRedeemMessage = message('pair.redeem', {
  code: z.string().min(1),
  deviceName: z.string().min(1).max(64),
  platform: z.string().max(64),
});

export const SessionsListMessage = message('sessions.list', {
  includeArchived: z.boolean().optional(),
});

export const WorkspaceListMessage = message('workspace.list', {});

export const SessionSubscribeMessage = message('session.subscribe', {
  sessionId: SessionId,
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

export const QuestionAnswerMessage = message('question.answer', {
  callId: z.string().min(1),
  sessionId: SessionId,
  answers: z.array(QuestionAnswerItem).min(1),
});

export const CommandsListMessage = message('commands.list', {
  sessionId: SessionId,
});

export const CommandRunMessage = message('command.run', {
  sessionId: SessionId,
  line: z.string().min(2).max(4_000),
});

export const RunStartMessage = message('run.start', {
  sessionId: SessionId,
  prompt: z.string().min(1).max(32_000),
});

export const RunCancelMessage = message('run.cancel', {
  sessionId: SessionId,
});

export const ModelListMessage = message('models.list', {});

export const ModelSelectMessage = message('model.select', {
  sessionId: SessionId,
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
});

export const PingMessage = message('ping', {});

export const SessionCreateMessage = message('session.create', {
  workspaceId: z.string().min(1),
});

export const WorkspaceArchiveMessage = message('workspace.archive', {
  sessionId: SessionId,
  stopActivity: z.boolean().optional(),
});

export const WorkspaceUnarchiveMessage = message('workspace.unarchive', {
  sessionId: SessionId,
});

export const ClientMessage = z.discriminatedUnion('type', [
  HelloMessage,
  PairRedeemMessage,
  SessionsListMessage,
  SessionCreateMessage,
  WorkspaceArchiveMessage,
  WorkspaceUnarchiveMessage,
  WorkspaceListMessage,
  ModelListMessage,
  ModelSelectMessage,
  SessionSubscribeMessage,
  SessionHistoryMessage,
  ReplySendMessage,
  QuestionAnswerMessage,
  CommandsListMessage,
  CommandRunMessage,
  RunStartMessage,
  RunCancelMessage,
  PingMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageType = ClientMessage['type'];

export const PongMessage = message('pong', {});

export const HelloOkMessage = message('hello.ok', {
  host: HostInfo,
  device: DeviceInfo.optional(),
});

export const PairOkMessage = message('pair.ok', {
  deviceToken: z.string().min(1),
  host: HostInfo,
  device: DeviceInfo,
});

export const SessionCreatedMessage = message('session.created', {
  sessionId: SessionId,
});

export const WorkspaceArchivedMessage = message('workspace.archived', {
  sessionId: SessionId,
});

export const WorkspaceUnarchivedMessage = message('workspace.unarchived', {
  sessionId: SessionId,
});

export const SessionsOkMessage = message('sessions.ok', {
  sessions: z.array(SessionSummary),
});

export const WorkspaceOkMessage = message('workspace.ok', {
  workspaces: z.array(Workspace),
});

export const ModelsOkMessage = message('models.ok', {
  catalog: ModelCatalog,
});

export const ModelSelectedMessage = message('model.selected', {
  sessionId: SessionId,
  selection: ModelSelection,
});

export const SessionOkMessage = message('session.ok', {
  sessionId: SessionId,
  seq: z.number().int().nonnegative(),
});

export const HistoryOkMessage = message('history.ok', {
  sessionId: SessionId,
  entries: z.array(HistoryEntry),
  hasMore: z.boolean(),
});

export const ReplyOkMessage = message('reply.ok', {
  sessionId: SessionId,
  seq: z.number().int().nonnegative().optional(),
});

export const AnswerOkMessage = message('answer.ok', {
  callId: z.string().min(1),
});

export const CommandsOkMessage = message('commands.ok', {
  commands: z.array(CommandInfo),
});

export const CommandOkMessage = message('command.ok', CommandResult.shape);

export const RunOkMessage = message('run.ok', {
  sessionId: SessionId,
  state: SessionState,
});

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

export const QuestionSettledMessage = message('question.settled', {
  callId: z.string().min(1),
  sessionId: SessionId,
  answers: z.array(QuestionAnswerItem).optional(),
});

export const DevicesChangedMessage = message('devices.changed', {
  devices: z.array(DeviceInfo),
});

export const ErrorMessage = message('error', {
  code: ErrorCode,
  message: z.string(),
  capabilities: Capabilities.optional(),
});

export const ServerMessage = z.discriminatedUnion('type', [
  PongMessage,
  HelloOkMessage,
  PairOkMessage,
  SessionsOkMessage,
  WorkspaceOkMessage,
  SessionOkMessage,
  SessionCreatedMessage,
  WorkspaceArchivedMessage,
  WorkspaceUnarchivedMessage,
  ModelsOkMessage,
  ModelSelectedMessage,
  HistoryOkMessage,
  ReplyOkMessage,
  AnswerOkMessage,
  CommandsOkMessage,
  CommandOkMessage,
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
