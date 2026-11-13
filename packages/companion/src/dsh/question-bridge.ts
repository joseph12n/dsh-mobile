import {
  PROTOCOL_VERSION,
  newMessageId,
  type QuestionAnswerItem,
  type QuestionBatch,
  type QuestionItem,
  type ServerMessage,
} from '@dsh-mobile/protocol';
import type { HostContext } from '../host-api.js';
import { toQuestionItem } from './questions.js';

export interface BridgeAnswer {
  answers: QuestionAnswerItem[];
}

export interface BridgeOutcome {
  ok: boolean;
  code?: 'not-found' | 'bad-request' | 'internal';
  message?: string;
}

interface PendingQuestion {
  readonly batch: QuestionBatch;
  readonly items: QuestionItem[];
  resolve(answer: BridgeAnswer): void;
  abort(error: Error): void;
}

export interface QuestionBridge {
  answer(input: {
    callId: string;
    sessionId: string;
    answers: QuestionAnswerItem[];
  }): BridgeOutcome | undefined;
  pendingBatches(): QuestionBatch[];
  counts(): Map<string, number>;
  dispose(): void;
}

type WaterfallListener = (
  request: unknown,
  next: () => Promise<BridgeAnswer>,
) => Promise<BridgeAnswer>;

interface EventContext {
  on?(
    name: 'user-questions/request',
    listener: WaterfallListener,
    options?: { prepend?: boolean; global?: boolean },
  ): (() => boolean) | undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function sessionIdOf(request: Record<string, unknown>): string | undefined {
  const agent = recordOf(request['agent']);
  const session = recordOf(agent?.['session']);
  const id = session?.['id'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function itemsOf(request: Record<string, unknown>): QuestionItem[] {
  const questions = request['questions'];
  if (!Array.isArray(questions)) return [];

  return questions.map(toQuestionItem).filter((item): item is QuestionItem => item !== undefined);
}

function pendingFrame(batch: QuestionBatch): ServerMessage {
  return {
    v: PROTOCOL_VERSION,
    id: newMessageId(),
    at: Date.now(),
    type: 'question.pending',
    question: batch,
  };
}

function settledFrame(callId: string, sessionId: string): ServerMessage {
  return {
    v: PROTOCOL_VERSION,
    id: newMessageId(),
    at: Date.now(),
    type: 'question.settled',
    callId,
    sessionId,
  };
}

function completeAnswer(
  items: readonly QuestionItem[],
  answers: readonly QuestionAnswerItem[],
): boolean {
  const expected = new Set(items.map((item) => item.id));
  const ids = answers.map((answer) => answer.id);

  return (
    ids.length === expected.size &&
    new Set(ids).size === ids.length &&
    ids.every((id) => expected.has(id))
  );
}

export function createQuestionBridge(
  ctx: HostContext,
  deps: { push: (message: ServerMessage) => void; clients: () => number },
): QuestionBridge {
  const pending = new Map<string, PendingQuestion>();
  let off: (() => boolean) | undefined;

  const handle = async (
    request: unknown,
    next: () => Promise<BridgeAnswer>,
  ): Promise<BridgeAnswer> => {
    const raw = recordOf(request);
    if (!raw || deps.clients() === 0 || recordOf(raw['wait'])) return next();

    const sessionId = sessionIdOf(raw);
    const items = itemsOf(raw);
    if (!sessionId || items.length === 0) return next();

    const session = sessionId;
    const callId = `mobile-${newMessageId()}`;
    const batch: QuestionBatch = {
      callId,
      sessionId: session,
      state: 'open',
      items,
      createdAt: Date.now(),
    };
    const signal = raw['signal'] as AbortSignal | undefined;

    return new Promise<BridgeAnswer>((resolve, reject) => {
      let finished = false;

      function onAbort(): void {
        finish(undefined, new Error('The question was cancelled before the phone answered.'));
      }

      function finish(answer?: BridgeAnswer, error?: Error): void {
        if (finished) return;
        finished = true;
        pending.delete(callId);
        signal?.removeEventListener('abort', onAbort);
        deps.push(settledFrame(callId, session));
        if (answer) resolve(answer);
        else reject(error ?? new Error('The question was cancelled before an answer arrived.'));
      }

      pending.set(callId, {
        batch,
        items,
        resolve: (answer) => finish(answer),
        abort: (error) => finish(undefined, error),
      });

      deps.push(pendingFrame(batch));

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener('abort', onAbort);

      void next().then(
        (answer) => finish(answer),
        () => undefined,
      );
    });
  };

  const answer: QuestionBridge['answer'] = (input) => {
    const entry = pending.get(input.callId);
    if (!entry) return undefined;

    if (!completeAnswer(entry.items, input.answers)) {
      return {
        ok: false,
        code: 'bad-request',
        message: 'The answer batch must name each question exactly once.',
      };
    }

    pending.delete(input.callId);
    entry.resolve({ answers: input.answers });
    return { ok: true };
  };

  const on = (ctx as EventContext).on;
  if (on) {
    off = on.call(ctx, 'user-questions/request', handle, { prepend: true, global: true });
  }

  return {
    answer,
    pendingBatches() {
      return [...pending.values()].map((entry) => entry.batch);
    },
    counts() {
      const counts = new Map<string, number>();
      for (const entry of pending.values()) {
        counts.set(entry.batch.sessionId, (counts.get(entry.batch.sessionId) ?? 0) + 1);
      }
      return counts;
    },
    dispose() {
      off?.();
      off = undefined;
      for (const entry of [...pending.values()]) {
        entry.abort(new Error('The question bridge was disposed.'));
      }
      pending.clear();
    },
  };
}
