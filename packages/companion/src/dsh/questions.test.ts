import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { answerQuestion, listPendingQuestions } from './questions.js';

const pendingExample = {
  callId: 'call-1',
  state: 'open',
  questions: [
    {
      id: 'q1',
      question: '¿Sigo con el siguiente robot?',
      header: 'confirmación',
      detail: 'Robot 3 de 8',
      options: [{ label: 'Sí' }, { label: 'No', description: 'parar aquí' }],
    },
    { id: 'q2', question: '¿Qué priorizo?', options: [], multiSelect: true },
  ],
};

function ctxWith(active: unknown[], sessions: string[] = ['s1']): HostContext {
  return {
    sessions: {
      list: () => sessions.map((id) => ({ id })),
      get: (id: string) => (sessions.includes(id) ? ({ id } as never) : undefined),
    },
    sessionProjections: {
      snapshot: () => ({ asOfSeq: 1, values: { userQuestions: { active, settled: [] } } }),
    },
    agents: { get: (id: string) => (sessions.includes(id) ? { id } : undefined) },
    userQuestions: {
      answer: () => true,
    },
  };
}

describe('lectura de lotes pendientes', () => {
  it('traduce un lote completo', () => {
    const [batch] = listPendingQuestions(ctxWith([pendingExample]));
    expect(batch?.callId).toBe('call-1');
    expect(batch?.sessionId).toBe('s1');
    expect(batch?.state).toBe('open');
    expect(batch?.items).toHaveLength(2);
  });

  it('conserva opciones, detalle y encabezado', () => {
    const [batch] = listPendingQuestions(ctxWith([pendingExample]));
    const first = batch?.items[0];
    expect(first?.text).toContain('¿Sigo');
    expect(first?.header).toBe('confirmación');
    expect(first?.detail).toBe('Robot 3 de 8');
    expect(first?.options.map((option) => option.label)).toEqual(['Sí', 'No']);
    expect(first?.options[1]?.description).toBe('parar aquí');
  });

  it('marca las de selección múltiple', () => {
    const [batch] = listPendingQuestions(ctxWith([pendingExample]));
    expect(batch?.items[1]?.multiSelect).toBe(true);
  });

  it('una aprobación no admite texto libre', () => {
    const approval = {
      callId: 'call-ap',
      state: 'open',
      questions: [
        {
          id: 'a1',
          question: '¿Permito ejecutar el comando?',
          intent: 'approval',
          options: [{ label: 'Rechazar' }, { label: 'Permitir' }],
        },
      ],
    };
    const [batch] = listPendingQuestions(ctxWith([approval]));
    expect(batch?.items[0]?.allowCustom).toBe(false);
  });

  it('una selección normal sí admite texto libre', () => {
    const [batch] = listPendingQuestions(ctxWith([pendingExample]));
    expect(batch?.items[0]?.allowCustom).toBe(true);
  });

  it('conserva el estado continued', () => {
    const continued = { ...pendingExample, state: 'continued' };
    const [batch] = listPendingQuestions(ctxWith([continued]));
    expect(batch?.state).toBe('continued');
  });

  it('descarta lotes sin preguntas o sin callId', () => {
    const raros = [{ callId: '', questions: [] }, { callId: 'x', questions: [] }, null, 42];
    expect(listPendingQuestions(ctxWith(raros))).toEqual([]);
  });

  it('recorre todas las sesiones vivas', () => {
    const batches = listPendingQuestions(ctxWith([pendingExample], ['s1', 's2']));
    expect(batches.map((batch) => batch.sessionId).sort()).toEqual(['s1', 's2']);
  });

  it('devuelve nada si el host no expone la proyección', () => {
    expect(listPendingQuestions({})).toEqual([]);
  });

  it('sobrevive a una proyección que falla', () => {
    const ctx: HostContext = {
      sessions: { list: () => [{ id: 's1' }], get: () => ({ id: 's1' }) },
      sessionProjections: {
        snapshot: () => {
          throw new Error('roto');
        },
      },
    };
    expect(listPendingQuestions(ctx)).toEqual([]);
  });
});

describe('respuesta a un lote', () => {
  const input = {
    callId: 'call-1',
    sessionId: 's1',
    answers: [{ id: 'q1', selected: ['Sí'] }],
  };

  it('acepta la respuesta cuando el agente vive', () => {
    expect(answerQuestion(ctxWith([]), input)).toEqual({ ok: true });
  });

  it('se niega si la sesión no está cargada, y lo explica', () => {
    const outcome = answerQuestion(ctxWith([], []), input);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('not-found');
    expect(outcome.message).toContain('is not loaded on the host');
  });

  it('informa cuando la pregunta ya no admite respuesta', () => {
    const ctx = ctxWith([]);
    (ctx['userQuestions'] as { answer: () => boolean }).answer = () => false;
    const outcome = answerQuestion(ctx, input);
    expect(outcome.code).toBe('bad-request');
    expect(outcome.message).toContain('no longer accepts an answer');
  });

  it('convierte una excepción del servicio en error de contrato', () => {
    const ctx = ctxWith([]);
    (ctx['userQuestions'] as { answer: () => boolean }).answer = () => {
      throw new Error('BAD_ANSWER');
    };
    expect(answerQuestion(ctx, input).code).toBe('bad-request');
  });

  it('falla con internal si el host no expone el servicio', () => {
    expect(answerQuestion({ agents: { get: () => ({}) } }, input).code).toBe('internal');
  });
});
