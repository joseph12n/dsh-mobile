import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope';
import type { ServerMessage } from '@dsh-mobile/protocol';
import type { HostContext } from '../host-api.js';
import { createQuestionBridge, type BridgeAnswer } from './question-bridge.js';

type Listener = (request: unknown, next: () => Promise<BridgeAnswer>) => Promise<BridgeAnswer>;

function harness(clients = 1) {
  let listener: Listener | undefined;
  const frames: ServerMessage[] = [];
  const ctx = {
    on: (_name: string, handler: Listener) => {
      listener = handler;
      return () => true;
    },
  } as unknown as HostContext;

  const bridge = createQuestionBridge(ctx, {
    push: (message) => frames.push(message),
    clients: () => clients,
  });

  return {
    bridge,
    frames,
    listener(): Listener {
      if (!listener) throw new Error('the bridge did not register a listener');
      return listener;
    },
  };
}

const request = {
  questions: [
    {
      id: 'q1',
      question: '¿Sigo?',
      header: 'Confirmar',
      options: [{ label: 'Sí' }, { label: 'No', description: 'mejor no' }],
      multiSelect: false,
    },
  ],
  agent: { session: { id: 'session-1' } },
};

const answer: BridgeAnswer = { answers: [{ id: 'q1', selected: ['Sí'] }] };

const desktopAnswer: BridgeAnswer = { answers: [{ id: 'q1', selected: ['No'] }] };

function pendingCall(
  frames: ServerMessage[],
): Extract<ServerMessage, { type: 'question.pending' }> {
  const frame = frames.find((item) => item.type === 'question.pending');
  if (!frame || frame.type !== 'question.pending') throw new Error('no pending frame');
  return frame;
}

describe('puente de preguntas bloqueantes', () => {
  it('anuncia el lote y resuelve con la respuesta del móvil', async () => {
    const h = harness();
    let asked = 0;
    const run = h.listener()(request, () => {
      asked += 1;
      return Promise.resolve(desktopAnswer);
    });

    const pending = pendingCall(h.frames);
    expect(pending.question.items[0]?.text).toBe('¿Sigo?');
    expect(pending.question.sessionId).toBe('session-1');
    expect(h.bridge.pendingBatches()).toHaveLength(1);
    expect(h.bridge.counts().get('session-1')).toBe(1);

    const outcome = h.bridge.answer({
      callId: pending.question.callId,
      sessionId: 'session-1',
      answers: answer.answers,
    });

    expect(outcome).toEqual({ ok: true });
    await expect(run).resolves.toEqual(answer);
    expect(asked).toBe(1);
    expect(h.frames.some((frame) => frame.type === 'question.settled')).toBe(true);
    expect(h.bridge.pendingBatches()).toEqual([]);
    expect(h.bridge.counts().size).toBe(0);
  });

  it('sin clientes delega en el escritorio y no anuncia nada', async () => {
    const h = harness(0);
    await expect(h.listener()(request, () => Promise.resolve(desktopAnswer))).resolves.toEqual(
      desktopAnswer,
    );
    expect(h.frames).toEqual([]);
  });

  it('una pregunta timed sigue el camino antiguo', async () => {
    const h = harness();
    const timed = { ...request, wait: { callId: 'tool-1', timed: true } };
    await expect(h.listener()(timed, () => Promise.resolve(desktopAnswer))).resolves.toEqual(
      desktopAnswer,
    );
    expect(h.frames).toEqual([]);
  });

  it('el escritorio puede contestar primero', async () => {
    const h = harness();
    await expect(h.listener()(request, () => Promise.resolve(desktopAnswer))).resolves.toEqual(
      desktopAnswer,
    );

    const pending = pendingCall(h.frames);
    expect(
      h.bridge.answer({
        callId: pending.question.callId,
        sessionId: 'session-1',
        answers: answer.answers,
      }),
    ).toBeUndefined();
  });

  it('rechaza un lote incompleto y deja la pregunta viva', async () => {
    const h = harness();
    const run = h.listener()(request, () => new Promise<BridgeAnswer>(() => undefined));
    const pending = pendingCall(h.frames);

    expect(
      h.bridge.answer({
        callId: pending.question.callId,
        sessionId: 'session-1',
        answers: [{ id: 'otra', selected: ['Sí'] }],
      }),
    ).toMatchObject({ ok: false, code: 'bad-request' });

    expect(
      h.bridge.answer({
        callId: pending.question.callId,
        sessionId: 'session-1',
        answers: answer.answers,
      }),
    ).toEqual({ ok: true });

    await expect(run).resolves.toEqual(answer);
  });

  it('abortar el turno rechaza y limpia la tarjeta', async () => {
    const h = harness();
    const controller = new AbortController();
    const run = h.listener()(
      { ...request, signal: controller.signal },
      () => new Promise<BridgeAnswer>(() => undefined),
    );
    const pending = pendingCall(h.frames);

    controller.abort();
    await expect(run).rejects.toThrow('cancelled');
    expect(
      h.bridge.answer({
        callId: pending.question.callId,
        sessionId: 'session-1',
        answers: answer.answers,
      }),
    ).toBeUndefined();
  });

  it('sin agente o sin preguntas delega', async () => {
    const h = harness();
    await expect(
      h.listener()({ questions: request.questions }, () => Promise.resolve(desktopAnswer)),
    ).resolves.toEqual(desktopAnswer);
    await expect(
      h.listener()({ agent: request.agent, questions: [] }, () => Promise.resolve(desktopAnswer)),
    ).resolves.toEqual(desktopAnswer);
    expect(h.frames).toEqual([]);
  });

  it('un callId ajeno no se apropia de la respuesta', () => {
    const h = harness();
    expect(
      h.bridge.answer({
        callId: 'call-de-otro',
        sessionId: 'session-1',
        answers: answer.answers,
      }),
    ).toBeUndefined();
  });

  it('dispose rechaza lo pendiente y retira el listener', async () => {
    const h = harness();
    const run = h.listener()(request, () => new Promise<BridgeAnswer>(() => undefined));
    h.bridge.dispose();

    await expect(run).rejects.toThrow('disposed');
    expect(h.frames.some((frame) => frame.type === 'question.settled')).toBe(true);
  });

  it('se engancha al waterfall real de cordis y gana al escritorio', async () => {
    const ctx = new Context();
    const frames: ServerMessage[] = [];
    const bridge = createQuestionBridge(ctx as unknown as HostContext, {
      push: (message) => frames.push(message),
      clients: () => 1,
    });
    const waterfall = (
      ctx as unknown as {
        waterfall(
          name: string,
          request: unknown,
          fallback: () => Promise<BridgeAnswer>,
        ): Promise<BridgeAnswer>;
      }
    ).waterfall.bind(ctx);

    const run = waterfall('user-questions/request', request, () => Promise.resolve(desktopAnswer));
    const pending = pendingCall(frames);

    expect(
      bridge.answer({
        callId: pending.question.callId,
        sessionId: 'session-1',
        answers: answer.answers,
      }),
    ).toEqual({ ok: true });

    await expect(run).resolves.toEqual(answer);
    bridge.dispose();
  });

  it('recibe el waterfall aunque venga con alcance de agente', async () => {
    const root = new Context();
    const frames: ServerMessage[] = [];
    const bridge = createQuestionBridge(root as unknown as HostContext, {
      push: (message) => frames.push(message),
      clients: () => 1,
    });
    const key = {};
    const scope = createScope(root, key);
    const carrier = scopeTarget({}, key);
    const dispatch = (
      root as unknown as {
        waterfall(
          thisArg: unknown,
          name: string,
          request: unknown,
          fallback: () => Promise<BridgeAnswer>,
        ): Promise<BridgeAnswer>;
      }
    ).waterfall.bind(root);

    const run = dispatch(carrier, 'user-questions/request', request, () =>
      Promise.resolve(desktopAnswer),
    );
    const pending = pendingCall(frames);

    expect(
      bridge.answer({
        callId: pending.question.callId,
        sessionId: 'session-1',
        answers: answer.answers,
      }),
    ).toEqual({ ok: true });

    await expect(run).resolves.toEqual(answer);
    bridge.dispose();
    await scope.dispose();
  });
});
