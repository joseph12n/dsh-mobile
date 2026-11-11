import { useState } from 'react';
import type { SessionSummary } from '@dsh-mobile/protocol';
import { groupSessions, relativeTime } from '../lib/sessions.js';

/**
 * Lista de sesiones agrupada por estado.
 *
 * El orden de las secciones lo decide `groupSessions`; aquí solo se pinta. La de
 * "más antiguas" arranca plegada porque no es lo que se mira al coger el
 * teléfono, y las demás no se pueden plegar: si están, importan.
 */

const STATE_LABEL: Record<SessionSummary['state'], string> = {
  working: 'trabajando',
  waiting: 'espera respuesta',
  idle: 'en reposo',
  done: 'terminada',
  error: 'error',
};

export function SessionList({
  sessions,
  onOpen,
}: {
  sessions: SessionSummary[];
  onOpen: (session: SessionSummary) => void;
}) {
  const [showStale, setShowStale] = useState(false);

  if (sessions.length === 0) {
    return <p className="muted">No hay sesiones vivas en el host.</p>;
  }

  const sections = groupSessions(sessions);

  return (
    <>
      {sections.map((section) => {
        const collapsed = section.kind === 'stale' && !showStale;

        return (
          <section key={section.kind} className={`group ${section.kind}`}>
            <header className="group-head">
              <h3>{section.title}</h3>
              <span className="count">{section.sessions.length}</span>
              {section.kind === 'stale' && (
                <button
                  type="button"
                  className="ghost tiny"
                  onClick={() => setShowStale((previous) => !previous)}
                  aria-expanded={showStale}
                  aria-controls={`grupo-${section.kind}`}
                >
                  {showStale ? 'Ocultar' : 'Mostrar'}
                </button>
              )}
            </header>

            {collapsed ? null : (
              <ul className="sessions" id={`grupo-${section.kind}`}>
                {section.sessions.map((session) => (
                  <li
                    key={session.id}
                    className="session-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(session)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      // Sin esto, Espacio además desplaza la página.
                      event.preventDefault();
                      onOpen(session);
                    }}
                  >
                    <div className="session-main">
                      <span className="session-title">{session.title}</span>
                      <span className="muted small">{relativeTime(session.updatedAt)}</span>
                    </div>
                    <div className="session-meta">
                      <span className={`badge ${session.state}`}>{STATE_LABEL[session.state]}</span>
                      {session.pendingQuestions > 0 && (
                        <span className="badge waiting">
                          {session.pendingQuestions} pregunta
                          {session.pendingQuestions > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
