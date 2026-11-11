import { useState } from 'react';
import type { HistoryEntry, SessionSummary, TranscriptEvent } from '@dsh-mobile/protocol';

/**
 * Transcripción de una sesión.
 *
 * Las entradas llegan de dos fuentes: la página inicial (`session.history`) y el
 * flujo vivo (`session.event`). Se fusionan por `seq`, así que un evento repetido
 * —reconexión, solapamiento de página— no se pinta dos veces.
 */

const STATE_LABEL: Record<string, string> = {
  working: 'trabajando',
  waiting: 'esperando respuesta',
  idle: 'en reposo',
  done: 'terminada',
  error: 'error',
};

function timeOf(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function EventRow({ entry }: { entry: HistoryEntry }) {
  const event: TranscriptEvent = entry.event;

  if (event.kind === 'message') {
    return (
      <li className={`msg ${event.role}`}>
        <span className="msg-role">{event.role === 'user' ? 'tú' : 'agente'}</span>
        <p>{event.text}</p>
      </li>
    );
  }

  if (event.kind === 'tool') {
    return (
      <li className={`tool ${event.status}`}>
        <span className="tool-name">{event.name}</span>
        {event.summary && <span className="tool-summary">{event.summary}</span>}
      </li>
    );
  }

  return (
    <li className="state-row">
      <span>{STATE_LABEL[event.state] ?? event.state}</span>
      <span className="muted small">{timeOf(entry.at)}</span>
    </li>
  );
}

export function SessionView({
  session,
  entries,
  hasMore,
  loading,
  onBack,
  onLoadMore,
  onCancel,
  onSend,
}: {
  session: SessionSummary;
  entries: HistoryEntry[];
  hasMore: boolean;
  loading: boolean;
  onBack: () => void;
  onLoadMore: () => void;
  onCancel: () => void;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <section className="card session-view">
      <div className="row">
        <button type="button" className="ghost" onClick={onBack}>
          ← Volver
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Detener
        </button>
      </div>

      <h2 className="session-heading">{session.title}</h2>
      <p className="muted small">{STATE_LABEL[session.state] ?? session.state}</p>

      {hasMore && (
        <button type="button" className="ghost load-more" onClick={onLoadMore} disabled={loading}>
          {loading ? 'Cargando…' : 'Cargar anteriores'}
        </button>
      )}

      {entries.length === 0 ? (
        <p className="muted">{loading ? 'Cargando…' : 'Todavía no hay nada que mostrar.'}</p>
      ) : (
        <ul className="transcript">
          {entries.map((entry) => (
            <EventRow key={`${entry.seq}-${entry.event.kind}`} entry={entry} />
          ))}
        </ul>
      )}

      {/* Composer fijo al final: se escribe sin perder de vista la conversación. */}
      <div className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter envía; Shift+Enter hace salto de línea.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Escribe al agente…"
          rows={2}
          autoCapitalize="sentences"
        />
        <button type="button" onClick={send} disabled={!draft.trim()}>
          Enviar
        </button>
      </div>
    </section>
  );
}
