import type {
  QuestionAnswerItem,
  QuestionBatch,
  QuestionItem,
  QuestionState,
} from '@deepseekharness-mobile/protocol';
import {
  service,
  type HostContext,
  type ProjectionsService,
  type SessionsService,
} from '../host-api.js';

interface RawQuestionItem {
  id?: unknown;
  question?: unknown;
  detail?: unknown;
  header?: unknown;
  multiSelect?: unknown;
  intent?: unknown;
  options?: unknown;
}

interface RawPending {
  callId?: unknown;
  questions?: unknown;
  state?: unknown;
}

interface AgentRegistry {
  get(sessionId: string): unknown;
}

interface UserQuestionsService {
  answer(agent: unknown, callId: string, answer: { answers: QuestionAnswerItem[] }): boolean;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function toQuestionItem(raw: unknown): QuestionItem | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const item = raw as RawQuestionItem;

  const id = asString(item.id);
  const text = asString(item.question);
  if (!id) return undefined;

  const options = Array.isArray(item.options)
    ? item.options
        .map((option) => {
          if (typeof option !== 'object' || option === null) return undefined;
          const record = option as { label?: unknown; description?: unknown };
          const label = asString(record.label);
          if (!label) return undefined;
          const description = asString(record.description);
          return { label, ...(description ? { description } : {}) };
        })
        .filter((option): option is { label: string; description?: string } => option !== undefined)
    : [];

  const intent = asString(item.intent);

  return {
    id,
    text,
    ...(asString(item.detail) ? { detail: asString(item.detail) } : {}),
    ...(asString(item.header) ? { header: asString(item.header) } : {}),
    options,
    multiSelect: item.multiSelect === true,
    allowCustom: intent !== 'approval',
  };
}

function toBatch(raw: unknown, sessionId: string): QuestionBatch | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const pending = raw as RawPending;

  const callId = asString(pending.callId);
  if (!callId) return undefined;

  const items = Array.isArray(pending.questions)
    ? pending.questions
        .map(toQuestionItem)
        .filter((item): item is QuestionItem => item !== undefined)
    : [];
  if (items.length === 0) return undefined;

  const state: QuestionState = pending.state === 'continued' ? 'continued' : 'open';

  return {
    callId,
    sessionId,
    state,
    items,
    createdAt: 0,
  };
}

function pendingOf(
  ctx: HostContext,
  sessionId: string,
  projections: ProjectionsService,
): QuestionBatch[] {
  const sessions = service<SessionsService>(ctx, 'sessions');
  const session = sessions?.get(sessionId);
  if (!session) return [];

  try {
    const view = projections.snapshot(session).values['userQuestions'] as
      { active?: unknown } | undefined;
    const active = view?.active;
    if (!Array.isArray(active)) return [];

    return active
      .map((raw) => toBatch(raw, sessionId))
      .filter((batch): batch is QuestionBatch => batch !== undefined);
  } catch {
    return [];
  }
}

export function listPendingQuestions(ctx: HostContext): QuestionBatch[] {
  const projections = service<ProjectionsService>(ctx, 'sessionProjections');
  const sessions = service<SessionsService>(ctx, 'sessions');
  if (!projections || !sessions) return [];

  let ids: string[];
  try {
    ids = sessions.list().map((session) => session.id);
  } catch {
    return [];
  }

  return ids.flatMap((id) => pendingOf(ctx, id, projections));
}

export interface AnswerOutcome {
  ok: boolean;
  code?: 'not-found' | 'bad-request' | 'internal';
  message?: string;
}

export function answerQuestion(
  ctx: HostContext,
  input: { callId: string; sessionId: string; answers: QuestionAnswerItem[] },
): AnswerOutcome {
  const userQuestions = service<UserQuestionsService>(ctx, 'userQuestions');
  if (!userQuestions) {
    return {
      ok: false,
      code: 'internal',
      message: 'The host does not expose the questions service.',
    };
  }

  const agents = service<AgentRegistry>(ctx, 'agents');
  const agent = agents?.get(input.sessionId);
  if (!agent) {
    return {
      ok: false,
      code: 'not-found',
      message: 'The session is not loaded on the host. Open it on the desktop and try again.',
    };
  }

  try {
    const accepted = userQuestions.answer(agent, input.callId, { answers: input.answers });
    if (!accepted) {
      return {
        ok: false,
        code: 'bad-request',
        message: 'That question no longer accepts an answer: the desktop may have answered it.',
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, code: 'bad-request', message: String(error) };
  }
}
