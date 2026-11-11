/**
 * Transcripción: historial paginado y eventos en vivo.
 *
 * Se delega en `ctx.sessionController`, que es lo que usa la interfaz del
 * escritorio: `page()` devuelve una página del registro y `observeEvent()` un
 * flujo de eventos según se confirman. No se lee el log por nuestra cuenta.
 *
 * La traducción es **tolerante a propósito**: los eventos de DSH son muchos y
 * cambian; aquí solo se reconocen los que el móvil sabe pintar y el resto se
 * descarta sin ruido. Adivinar la forma exacta de cada uno sería peor que
 * ignorarlo.
 */
import type { HistoryEntry, SessionState, TranscriptEvent } from '@dsh-mobile/protocol';
import { service, type HostContext } from '../host-api.js';

/** Envoltura del registro tal como viaja por el controlador. */
interface WireEvent {
  type?: unknown;
  seq?: unknown;
  time?: unknown;
  data?: unknown;
}

interface WireRecord {
  type?: unknown;
  event?: WireEvent;
  /** Los cambios de estado del turno pueden viajar como estado, no como evento. */
  state?: unknown;
}

interface PageValue {
  records?: readonly WireRecord[];
  hasMore?: boolean;
}

interface SessionControllerHistory {
  page(
    request: {
      address: { kind: 'session'; sessionId: string };
      beforeSeq?: number;
      maxMessages?: number;
    },
    signal: AbortSignal,
  ): Promise<PageValue>;
  observeEvent(
    request: { address: { kind: 'session'; sessionId: string } },
    signal: AbortSignal,
  ): AsyncIterable<WireRecord> | AsyncGenerator<WireRecord>;
  cancel(request: { sessionId: string }): { accepted: boolean };
}

function controller(ctx: HostContext): SessionControllerHistory | undefined {
  return service<SessionControllerHistory>(ctx, 'sessionController');
}

function address(sessionId: string): { kind: 'session'; sessionId: string } {
  return { kind: 'session', sessionId };
}

/** Primer texto que aparezca en una estructura desconocida. */
function firstText(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    const parts = value.map((item) => firstText(item, depth + 1)).filter(Boolean);
    return parts.length > 0 ? parts.join('') : undefined;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Los bloques de contenido son la forma habitual: { type: 'text', text }.
    if (typeof record['text'] === 'string') return record['text'];
    for (const key of ['content', 'message', 'delta', 'value']) {
      const found = firstText(record[key], depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

/** Estado del móvil a partir del nombre del evento. */
function stateOf(type: string): SessionState | undefined {
  switch (type) {
    case 'turn/start':
    case 'step/start':
      return 'working';
    case 'turn/end':
      return 'idle';
    default:
      return undefined;
  }
}

/**
 * Traduce un evento del registro al vocabulario del móvil.
 *
 * Devuelve `undefined` para todo lo que el móvil no pinta: preferimos un hueco a
 * un renglón inventado.
 */
export function toTranscriptEvent(wire: WireEvent): TranscriptEvent | undefined {
  const type = typeof wire.type === 'string' ? wire.type : '';
  const data = wire.data;

  if (type === 'user/message' || type === 'user-rpc') {
    const text = firstText(data);
    return text ? { kind: 'message', role: 'user', text } : undefined;
  }

  if (type === 'assistant/message') {
    const text = firstText(data);
    return text ? { kind: 'message', role: 'assistant', text } : undefined;
  }

  if (type === 'tool/call') {
    const record = (data ?? {}) as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'] : 'herramienta';
    const summary = firstText(record['input']) ?? firstText(record['args']) ?? '';
    return { kind: 'tool', name, summary: summary.slice(0, 200), status: 'running' };
  }

  if (type === 'tool/result') {
    const record = (data ?? {}) as Record<string, unknown>;
    const isError = record['error'] !== undefined || record['isError'] === true;
    const name = typeof record['name'] === 'string' ? record['name'] : 'herramienta';
    return {
      kind: 'tool',
      name,
      summary: (firstText(record['output']) ?? '').slice(0, 200),
      status: isError ? 'error' : 'ok',
    };
  }

  const state = stateOf(type);
  return state ? { kind: 'state', state } : undefined;
}

function toEntry(record: WireRecord): HistoryEntry | undefined {
  const wire = record.event;
  if (!wire) return undefined;

  const seq = typeof wire.seq === 'number' ? wire.seq : 0;
  const at = typeof wire.time === 'number' ? wire.time : 0;
  const event = toTranscriptEvent(wire);
  if (!event) return undefined;

  return { seq, at, event };
}

export interface HistoryPage {
  entries: HistoryEntry[];
  hasMore: boolean;
}

/**
 * Una página de historial.
 *
 * `before` pagina hacia atrás; sin él devuelve lo más reciente.
 */
export async function readHistory(
  ctx: HostContext,
  sessionId: string,
  options: { before?: number; limit?: number } = {},
): Promise<HistoryPage> {
  const api = controller(ctx);
  if (!api) return { entries: [], hasMore: false };

  const request: {
    address: { kind: 'session'; sessionId: string };
    beforeSeq?: number;
    maxMessages?: number;
  } = { address: address(sessionId) };

  if (options.before !== undefined) request.beforeSeq = options.before;
  request.maxMessages = options.limit ?? 40;

  try {
    const page = await api.page(request, new AbortController().signal);
    const records = page.records ?? [];

    const entries = records
      .map(toEntry)
      .filter((entry): entry is HistoryEntry => entry !== undefined);

    return { entries, hasMore: page.hasMore === true };
  } catch {
    return { entries: [], hasMore: false };
  }
}

export interface Subscription {
  stop(): void;
}

/**
 * Se suscribe a los eventos de una sesión.
 *
 * El bucle vive en el host y empuja hacia el cliente; se corta abortando la
 * señal o cerrando el socket. Los errores del flujo terminan la suscripción sin
 * tumbar la conexión.
 */
export function subscribeSession(
  ctx: HostContext,
  sessionId: string,
  options: { since?: number; onEvent: (entry: HistoryEntry) => void; onEnd?: () => void },
): Subscription {
  const api = controller(ctx);
  const abort = new AbortController();

  if (!api) {
    options.onEnd?.();
    return { stop: () => undefined };
  }

  void (async () => {
    try {
      const stream = api.observeEvent({ address: address(sessionId) }, abort.signal);
      for await (const frame of stream) {
        if (abort.signal.aborted) return;

        const entry = toEntry(frame);
        if (!entry) continue;

        // `since` descarta lo que el cliente ya tiene.
        if (options.since !== undefined && entry.seq <= options.since) continue;
        options.onEvent(entry);
      }
    } catch {
      // Flujo cortado o sesión cerrada.
    } finally {
      options.onEnd?.();
    }
  })();

  return {
    stop() {
      abort.abort();
    },
  };
}

/** Cancela el turno en curso de una sesión. */
export function cancelRun(ctx: HostContext, sessionId: string): boolean {
  const api = controller(ctx);
  if (!api) return false;
  try {
    return api.cancel({ sessionId }).accepted === true;
  } catch {
    return false;
  }
}
