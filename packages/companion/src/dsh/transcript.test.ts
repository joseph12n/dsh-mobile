import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { cancelRun, readHistory, subscribeSession, toTranscriptEvent } from './transcript.js';

describe('traducción de eventos', () => {
  it('lee un mensaje del usuario con bloques de contenido', () => {
    const event = toTranscriptEvent({
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'arregla el bug' }] },
    });
    expect(event).toEqual({ kind: 'message', role: 'user', text: 'arregla el bug' });
  });

  it('tolera la forma anidada en `message`', () => {
    const event = toTranscriptEvent({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'listo' }] } },
    });
    expect(event).toEqual({ kind: 'message', role: 'assistant', text: 'listo' });
  });

  it('une varios bloques de texto', () => {
    const event = toTranscriptEvent({
      type: 'assistant/message',
      data: {
        content: [
          { type: 'text', text: 'uno ' },
          { type: 'text', text: 'dos' },
        ],
      },
    });
    expect(event).toEqual({ kind: 'message', role: 'assistant', text: 'uno dos' });
  });

  it('marca una llamada a herramienta como en curso', () => {
    const event = toTranscriptEvent({
      type: 'tool/call',
      data: { name: 'read', input: { path: 'README.md' } },
    });
    expect(event).toMatchObject({ kind: 'tool', name: 'read', status: 'running' });
  });

  it('distingue el resultado correcto del fallido', () => {
    const ok = toTranscriptEvent({
      type: 'tool/result',
      data: { name: 'read', output: 'contenido' },
    });
    const bad = toTranscriptEvent({
      type: 'tool/result',
      data: { name: 'read', error: 'no existe' },
    });
    expect(ok).toMatchObject({ status: 'ok' });
    expect(bad).toMatchObject({ status: 'error' });
  });

  it('traduce el arranque y el fin del turno a estado', () => {
    expect(toTranscriptEvent({ type: 'turn/start' })).toEqual({ kind: 'state', state: 'working' });
    expect(toTranscriptEvent({ type: 'turn/end' })).toEqual({ kind: 'state', state: 'idle' });
  });

  it('descarta lo que no sabe pintar', () => {
    expect(toTranscriptEvent({ type: 'session/title', data: { title: 'x' } })).toBeUndefined();
    expect(toTranscriptEvent({ type: 'algo/desconocido' })).toBeUndefined();
    expect(toTranscriptEvent({})).toBeUndefined();
  });

  it('descarta un mensaje sin texto en vez de pintar uno vacío', () => {
    expect(toTranscriptEvent({ type: 'user/message', data: { content: [] } })).toBeUndefined();
  });
});

function ctxWithPage(records: unknown[], hasMore = false): HostContext {
  return {
    sessionController: {
      page: () => Promise.resolve({ records, hasMore }),
      observeEvent: () => ({ async *[Symbol.asyncIterator]() {} }),
      cancel: () => ({ accepted: true }),
    },
  };
}

function record(seq: number, type: string, data: unknown) {
  return { type: 'event', event: { type, seq, time: 1_700_000_000_000 + seq, data } };
}

describe('historial paginado', () => {
  it('traduce y numera las entradas', async () => {
    const ctx = ctxWithPage([
      record(1, 'user/message', { content: [{ type: 'text', text: 'hola' }] }),
      record(2, 'assistant/message', { content: [{ type: 'text', text: 'qué tal' }] }),
    ]);
    const page = await readHistory(ctx, 's1');
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0]).toMatchObject({ seq: 1, event: { role: 'user' } });
  });

  it('descarta los eventos no reconocidos sin romper la página', async () => {
    const ctx = ctxWithPage([
      record(1, 'session/title', {}),
      record(2, 'user/message', { content: [{ type: 'text', text: 'hola' }] }),
    ]);
    const page = await readHistory(ctx, 's1');
    expect(page.entries).toHaveLength(1);
  });

  it('propaga hasMore', async () => {
    expect((await readHistory(ctxWithPage([], true), 's1')).hasMore).toBe(true);
  });

  it('devuelve página vacía sin controlador', async () => {
    expect(await readHistory({}, 's1')).toEqual({ entries: [], hasMore: false });
  });

  it('devuelve página vacía si el controlador falla', async () => {
    const ctx: HostContext = {
      sessionController: { page: () => Promise.reject(new Error('boom')) },
    };
    expect(await readHistory(ctx, 's1')).toEqual({ entries: [], hasMore: false });
  });
});

describe('suscripción a eventos', () => {
  it('empuja los eventos que llegan', async () => {
    const received: number[] = [];
    const ctx: HostContext = {
      sessionController: {
        observeEvent: () => ({
          async *[Symbol.asyncIterator]() {
            yield record(1, 'user/message', { content: [{ type: 'text', text: 'a' }] });
            yield record(2, 'turn/start', {});
          },
        }),
      },
    };

    const done = new Promise<void>((resolve) => {
      subscribeSession(ctx, 's1', {
        onEvent: (entry) => received.push(entry.seq),
        onEnd: resolve,
      });
    });

    await done;
    expect(received).toEqual([1, 2]);
  });

  it('descarta lo anterior al cursor `since`', async () => {
    const received: number[] = [];
    const ctx: HostContext = {
      sessionController: {
        observeEvent: () => ({
          async *[Symbol.asyncIterator]() {
            yield record(1, 'turn/start', {});
            yield record(2, 'turn/start', {});
            yield record(5, 'turn/start', {});
          },
        }),
      },
    };

    await new Promise<void>((resolve) => {
      subscribeSession(ctx, 's1', {
        since: 2,
        onEvent: (entry) => received.push(entry.seq),
        onEnd: resolve,
      });
    });

    expect(received).toEqual([5]);
  });

  it('termina sin lanzar si no hay controlador', () => {
    let ended = false;
    subscribeSession({}, 's1', { onEvent: () => undefined, onEnd: () => (ended = true) });
    expect(ended).toBe(true);
  });

  it('cerrar antes de tiempo no lanza', async () => {
    const ctx: HostContext = {
      sessionController: {
        observeEvent: () => ({
          async *[Symbol.asyncIterator]() {
            yield record(1, 'turn/start', {});
          },
        }),
      },
    };
    const subscription = subscribeSession(ctx, 's1', { onEvent: () => undefined });
    subscription.stop();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});

describe('cancelación de ejecución', () => {
  it('acepta cuando el host confirma', () => {
    expect(cancelRun(ctxWithPage([]), 's1')).toBe(true);
  });

  it('rechaza cuando el host no confirma', () => {
    const ctx: HostContext = { sessionController: { cancel: () => ({ accepted: false }) } };
    expect(cancelRun(ctx, 's1')).toBe(false);
  });

  it('rechaza sin controlador o si el host lanza', () => {
    expect(cancelRun({}, 's1')).toBe(false);
    const ctx: HostContext = {
      sessionController: {
        cancel: () => {
          throw new Error('no vivo');
        },
      },
    };
    expect(cancelRun(ctx, 's1')).toBe(false);
  });
});
