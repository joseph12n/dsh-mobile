import { useState } from 'react';
import type { HistoryEntry, SessionSummary, TranscriptEvent } from '@dsh-mobile/protocol';
import { groupTurns, toolEntries, visibleEntries, type Turn } from '../lib/turns.js';

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

/**
 * Un turno: lo que pidió el humano y lo que provocó.
 *
 * Las herramientas van **plegadas** porque son muchas y ruidosas; lo que cuenta
 * qué pasó —mensajes y cambios de estado— siempre se ve. La primera pregunta de
 * cada turno hace de encabezado, así que no se repite abajo.
 */
function TurnBlock({ turn, number }: { turn: Turn; number: number }) {
  const [showTools, setShowTools] = useState(false);

  const prompts = turn.entries.filter(
    (entry) => entry.event.kind === 'message' && entry.event.role === 'user',
  );
  const rest = turn.entries.filter((entry) => !prompts.includes(entry));
  const tools = toolEntries(turn);
  const visible = visibleEntries(turn).filter((entry) => !prompts.includes(entry));

  return (
    <section className="turn">
      <header className="turn-head">
        <span className="turn-number">Turno {number}</span>
        <span className="muted small">{timeOf(turn.at)}</span>
      </header>

      <ul className="transcript">
        {prompts.map((entry) => (
          <EventRow key={entry.seq} entry={entry} />
        ))}

        {visible.map((entry) => (
          <EventRow key={`${entry.seq}-${entry.event.kind}`} entry={entry} />
        ))}

        {tools.length > 0 && (
          <li className="tool-group">
            <button
              type="button"
              className="ghost tiny"
              onClick={() => setShowTools((previous) => !previous)}
              aria-expanded={showTools}
              aria-controls={`herramientas-${turn.id}`}
            >
              {tools.length} herramienta{tools.length > 1 ? 's' : ''}
              {showTools ? ' · ocultar' : ''}
            </button>

            {showTools && (
              <ul className="transcript nested" id={`herramientas-${turn.id}`}>
                {tools.map((entry) => (
                  <EventRow key={`${entry.seq}-${entry.event.kind}`} entry={entry} />
                ))}
              </ul>
            )}
          </li>
        )}

        {/* Entradas que no son ni pregunta, ni mensaje visible, ni herramienta:
            no debería quedar ninguna, pero si queda se pinta en vez de perderse. */}
        {rest
          .filter((entry) => entry.event.kind !== 'tool')
          .filter((entry) => !visible.includes(entry))
          .map((entry) => (
            <EventRow key={`resto-${entry.seq}`} entry={entry} />
          ))}
      </ul>
    </section>
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
        <div className="transcript">
          {groupTurns(entries).map((turn, index) => (
            <TurnBlock key={turn.id} turn={turn} number={index + 1} />
          ))}
        </div>
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
