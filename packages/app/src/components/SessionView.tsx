import { useState } from 'react';
import type { HistoryEntry, SessionSummary, TranscriptEvent } from '@dsh-mobile/protocol';
import { groupTurns, partTurn, type Turn } from '../lib/turns.js';

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
 * Una racha de herramientas seguidas dentro de un turno.
 *
 * El estado y el `id` son **por racha**, no por turno: un turno puede tener varias
 * (herramientas, respuesta, más herramientas), y compartir el `id` producía ids
 * duplicados y un `aria-controls` que apuntaba al grupo equivocado. Además, con un
 * estado por turno, pulsar un botón desplegaba todas las rachas aunque dijera
 * "1 herramienta".
 */
function ToolRun({ entries }: { entries: HistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  const id = `herramientas-${entries[0]?.seq ?? 0}`;

  return (
    <li className="tool-group">
      <button
        type="button"
        className="ghost tiny"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        // Solo apunta al grupo cuando existe: una referencia a un id que no está
        // renderizado es ARIA inválido.
        aria-controls={open ? id : undefined}
      >
        {entries.length} herramienta{entries.length > 1 ? 's' : ''}
        {open ? ' · ocultar' : ''}
      </button>

      {open && (
        <ul className="transcript nested" id={id}>
          {entries.map((entry) => (
            <EventRow key={`${entry.seq}-tool`} entry={entry} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Un turno: lo que pidió el humano y lo que provocó.
 *
 * Las herramientas van **plegadas** porque son muchas y ruidosas; los mensajes y
 * los cambios de estado siempre se ven, dentro del turno y **en su orden real**.
 */
function TurnBlock({ turn, number }: { turn: Turn; number: number }) {
  const parts = partTurn(turn.entries);
  const label = turn.prompt ? `Turno ${number}: ${turn.prompt}` : `Turno ${number}`;

  return (
    <section className="turn" aria-label={label}>
      <header className="turn-head">
        <span className="turn-number">Turno {number}</span>
        <span className="muted small">{timeOf(turn.at)}</span>
      </header>

      <ul className="transcript">
        {parts.map((part) =>
          part.kind === 'entry' ? (
            <EventRow key={part.entry.seq} entry={part.entry} />
          ) : (
            <ToolRun key={`herramientas-${part.entries[0]?.seq ?? 0}`} entries={part.entries} />
          ),
        )}
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
