import { z } from 'zod';

export const SessionId = z.string().min(1);
export type SessionId = z.infer<typeof SessionId>;

export const SessionState = z.enum(['idle', 'working', 'waiting', 'done', 'error']);
export type SessionState = z.infer<typeof SessionState>;

export const Capability = z.enum([
  'session.create',
  'workspace.archive',
  'session.history',
  'reply.send',
  'question.answer',
  'run.start',
  'run.cancel',
  'workspace.list',
  'workspace.unarchive',
  'model.select',
  'command.run',
  'session.activity',
  'devices.manage',
  'providers.list',
  'provider.connect',
]);
export type Capability = z.infer<typeof Capability>;

export const Capabilities = z.array(z.string().min(1));
export type Capabilities = z.infer<typeof Capabilities>;

export const ModelSelection = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
});
export type ModelSelection = z.infer<typeof ModelSelection>;

export const ReasoningEffortOption = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
});
export type ReasoningEffortOption = z.infer<typeof ReasoningEffortOption>;

export const ModelOption = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  reasoningEfforts: z.array(ReasoningEffortOption).optional(),
  defaultReasoningEffort: z.string().min(1).optional(),
});
export type ModelOption = z.infer<typeof ModelOption>;

export const ModelGroup = z.object({
  id: z.string().min(1),
  name: z.string(),
  models: z.array(ModelOption),
});
export type ModelGroup = z.infer<typeof ModelGroup>;

export const ModelFailure = z.object({
  id: z.string().min(1),
  name: z.string(),
  message: z.string(),
});
export type ModelFailure = z.infer<typeof ModelFailure>;

export const ModelCatalog = z.object({
  default: ModelSelection.optional(),
  groups: z.array(ModelGroup),
  failures: z.array(ModelFailure),
});
export type ModelCatalog = z.infer<typeof ModelCatalog>;

export const SessionSummary = z.object({
  id: SessionId,
  title: z.string(),
  state: SessionState,
  updatedAt: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  pendingQuestions: z.number().int().nonnegative(),
  model: ModelSelection.optional(),
  archived: z.boolean().optional(),
  workspaceId: z.string().optional(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const Workspace = z.object({
  id: z.string().min(1),
  title: z.string(),
  directory: z.string().min(1),
  sessionIds: z.array(SessionId),
});
export type Workspace = z.infer<typeof Workspace>;

export const TranscriptEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    role: z.enum(['user', 'assistant']),
    text: z.string(),
    reasoning: z.string().optional(),
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

export const QuestionOption = z.object({
  label: z.string(),
  description: z.string().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const QuestionItem = z.object({
  id: z.string().min(1),
  text: z.string(),
  detail: z.string().optional(),
  header: z.string().optional(),
  options: z.array(QuestionOption),
  multiSelect: z.boolean(),
  allowCustom: z.boolean(),
});
export type QuestionItem = z.infer<typeof QuestionItem>;

export const QuestionState = z.enum(['open', 'continued']);
export type QuestionState = z.infer<typeof QuestionState>;

export const QuestionBatch = z.object({
  callId: z.string().min(1),
  sessionId: SessionId,
  state: QuestionState,
  items: z.array(QuestionItem),
  createdAt: z.number().int().nonnegative(),
});
export type QuestionBatch = z.infer<typeof QuestionBatch>;

export const CommandInfo = z.object({
  name: z.string().min(1),
  description: z.string(),
  hint: z.string().optional(),
});
export type CommandInfo = z.infer<typeof CommandInfo>;

export const CommandResult = z.object({
  kind: z.enum(['success', 'error']),
  text: z.string().optional(),
});
export type CommandResult = z.infer<typeof CommandResult>;

export const ActivityGoal = z.object({
  objective: z.string(),
  phase: z.string(),
  roundsStarted: z.number().int().nonnegative(),
  maxRounds: z.number().int().positive().optional(),
});
export type ActivityGoal = z.infer<typeof ActivityGoal>;

export const ActivitySubagent = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  activity: z.enum(['running', 'inactive']),
  depth: z.number().int().positive(),
  hasChildren: z.boolean().optional(),
});
export type ActivitySubagent = z.infer<typeof ActivitySubagent>;

export const ActivityTodo = z.object({
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
});
export type ActivityTodo = z.infer<typeof ActivityTodo>;

export const SessionActivity = z.object({
  goal: ActivityGoal.optional(),
  subagents: z.array(ActivitySubagent).max(50),
  todos: z
    .object({
      open: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      items: z.array(ActivityTodo).max(10),
    })
    .optional(),
  planActive: z.boolean().optional(),
});
export type SessionActivity = z.infer<typeof SessionActivity>;

export const ProviderCredential = z.enum(['set', 'missing', 'unknown']);
export type ProviderCredential = z.infer<typeof ProviderCredential>;

export const ProviderCredentialSource = z.enum(['file', 'env', 'project-env', 'user-env']);
export type ProviderCredentialSource = z.infer<typeof ProviderCredentialSource>;

export const ProviderAction = z.enum(['add-key', 'add-provider', 'none', 'desktop']);
export type ProviderAction = z.infer<typeof ProviderAction>;

export const ProviderView = z.object({
  id: z.string().min(1),
  name: z.string(),
  configured: z.boolean(),
  credential: ProviderCredential,
  credentialSource: ProviderCredentialSource.optional(),
  action: ProviderAction,
});
export type ProviderView = z.infer<typeof ProviderView>;

export const ProviderTestCode = z.enum(['ok', 'rejected', 'unreachable', 'unsupported', 'invalid']);
export type ProviderTestCode = z.infer<typeof ProviderTestCode>;

export const ProviderTestResult = z.object({
  provider: z.string().min(1),
  ok: z.boolean(),
  code: ProviderTestCode,
  detail: z.string().optional(),
});
export type ProviderTestResult = z.infer<typeof ProviderTestResult>;

export const ProviderConnection = z.object({
  provider: z.string().min(1),
  credential: ProviderCredential,
  credentialSource: ProviderCredentialSource.optional(),
});
export type ProviderConnection = z.infer<typeof ProviderConnection>;

export const QuestionAnswerItem = z.object({
  id: z.string().min(1),
  selected: z.array(z.string()),
  custom: z.string().optional(),
});
export type QuestionAnswerItem = z.infer<typeof QuestionAnswerItem>;

export const HostInfo = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  capabilities: Capabilities,
});
export type HostInfo = z.infer<typeof HostInfo>;

export const DeviceInfo = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;
