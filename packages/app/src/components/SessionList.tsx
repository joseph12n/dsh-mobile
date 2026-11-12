import { useId, useState } from 'react';
import type { SessionSummary, Workspace } from '@dsh-mobile/protocol';
import { groupSessions, elapsed } from '../lib/sessions.js';
import { displayTitle, groupByFolder, usesFolders } from '../lib/folders.js';
import { plural, useI18n } from '../i18n/index.js';

/**
 * Session list.
 *
 * Two shapes, and which one you get is decided by the host:
 *
 *  - **With folders** (the desktop's Workspaces): one section per folder, sessions inside
 *    ordered by urgency. This is how the desktop reads.
 *  - **Without folders**: the sections by state, as before. A host that does not expose
 *    workspaces is still a valid host and must not look broken.
 *
 * The state stays visible either way: a badge on every row, and the waiting count.
 */

const STATE_KEY = {
  working: 'session.working',
  waiting: 'session.waiting',
  idle: 'session.idle',
  done: 'session.done',
  error: 'session.error',
} as const;

const SECTION_KEY = {
  waiting: 'group.waiting',
  working: 'group.working',
  idle: 'group.idle',
  stale: 'group.stale',
} as const;

export function SessionList({
  sessions,
  workspaces,
  onOpen,
  onCreate,
  onArchive,
  canCreate = false,
  canArchive = false,
  createPending,
  archivePending,
}: {
  sessions: SessionSummary[];
  workspaces: Workspace[];
  onOpen: (session: SessionSummary) => void;
  /** Creates a session in that folder. Absent when the host cannot. */
  onCreate?: (workspaceId: string) => void;
  onArchive?: (session: SessionSummary) => void;
  canCreate?: boolean;
  canArchive?: boolean;
  /** Folder whose create is in flight. Its button is disabled until it settles. */
  createPending?: string;
  /** Session whose archive is in flight, for the same reason. */
  archivePending?: string;
}) {
  const { t } = useI18n();
  const [showStale, setShowStale] = useState(false);

  const folders = groupByFolder(sessions, workspaces);

  // Sin carpetas y sin sesiones, el aviso. Con carpetas, se pintan igual: es donde
  // irían las sesiones nuevas y esconderlas borraba la agrupación entera.
  if (sessions.length === 0 && !usesFolders(workspaces)) {
    return <p className="muted">{t('sessions.empty')}</p>;
  }

  if (usesFolders(workspaces)) {
    return (
      <>
        {folders.map((section, index) => {
          const id = section.workspace?.id ?? 'no-folder';
          // A folder with nothing in it is still shown: it is where new sessions would go,
          // and hiding it makes the app look like it lost a folder.
          const empty = section.sessions.length === 0;

          return (
            <section key={id} className="group folder">
              <header className="group-head">
                <h3 title={section.workspace?.directory}>
                  {section.workspace ? displayTitle(section.workspace) : t('group.noFolder')}
                </h3>
                <span className="count">{section.sessions.length}</span>
                {section.workspace && canCreate && onCreate && (
                  <button
                    type="button"
                    className="ghost tiny"
                    // Todos los botones se llaman igual: sin la carpeta, un lector de
                    // pantalla anuncia seis "Nueva sesión" idénticos.
                    aria-label={`${t('action.newSession')}: ${displayTitle(section.workspace)}`}
                    disabled={createPending !== undefined}
                    onClick={() => onCreate(section.workspace!.id)}
                  >
                    {t('action.newSession')}
                  </button>
                )}
              </header>

              {empty ? (
                <p className="muted small">{t('group.emptyFolder')}</p>
              ) : (
                <ul className="sessions" id={`folder-${index}`}>
                  {section.sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      onOpen={onOpen}
                      {...(onArchive ? { onArchive } : {})}
                      canArchive={canArchive}
                      {...(archivePending ? { archivePending } : {})}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </>
    );
  }

  const sections = groupSessions(sessions);

  return (
    <>
      {sections.map((section) => {
        const collapsed = section.kind === 'stale' && !showStale;

        return (
          <section key={section.kind} className={`group ${section.kind}`}>
            <header className="group-head">
              <h3>{t(SECTION_KEY[section.kind])}</h3>
              <span className="count">{section.sessions.length}</span>
              {section.kind === 'stale' && (
                <button
                  type="button"
                  className="ghost tiny"
                  onClick={() => setShowStale((previous) => !previous)}
                  aria-expanded={showStale}
                  aria-controls={showStale ? `group-${section.kind}` : undefined}
                >
                  {showStale ? t('group.hide') : t('group.show')}
                </button>
              )}
            </header>

            {collapsed ? null : (
              <ul className="sessions" id={`group-${section.kind}`}>
                {section.sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onOpen={onOpen}
                    {...(onArchive ? { onArchive } : {})}
                    canArchive={canArchive}
                    {...(archivePending ? { archivePending } : {})}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

/** One session. The same row in both shapes: the state is always visible. */
function SessionRow({
  session,
  onOpen,
  onArchive,
  canArchive,
  archivePending,
}: {
  session: SessionSummary;
  onOpen: (session: SessionSummary) => void;
  onArchive?: (session: SessionSummary) => void;
  canArchive: boolean;
  /** Sesión cuyo archivo está en vuelo: su botón se deshabilita. */
  archivePending?: string;
}) {
  const { t } = useI18n();
  const age = elapsed(session.updatedAt);
  const stateId = useId();

  return (
    <li className="session-row">
      {/* Un botón de verdad, no un `li` con `role="button"`: dentro vive otro botón
          (Archivar) y las interacciones anidadas confundían a los lectores de pantalla.
          Además, la tecla Enter sobre Archivar burbujeaba al `li` y abría la sesión. */}
      <button
        type="button"
        className="session-open"
        aria-describedby={stateId}
        onClick={() => onOpen(session)}
      >
        <span className="session-title">{session.title}</span>
        <span className="muted small">
          {age ? t(unitKey(age), { count: 'count' in age ? age.count : 0 }) : ''}
        </span>
      </button>
      <div className="session-meta">
        {/* El estado queda fuera del nombre del botón: `aria-describedby` lo asocia
            sin que el nombre arrastre "working" en cada fila. */}
        <span id={stateId} className={`badge ${session.state}`}>
          {t(STATE_KEY[session.state])}
        </span>
        {canArchive && onArchive && (
          <button
            type="button"
            className="ghost tiny"
            aria-label={`${t('action.archive')}: ${session.title}`}
            disabled={archivePending !== undefined}
            onClick={() => onArchive(session)}
          >
            {t('action.archive')}
          </button>
        )}
        {session.pendingQuestions > 0 && (
          <span className="badge waiting">
            {plural(t, 'session.questionCount', session.pendingQuestions)}
          </span>
        )}
      </div>
    </li>
  );
}

/** Catalogue key for an elapsed value. */
function unitKey(age: {
  unit: 'now' | 'minutes' | 'hours' | 'days';
}): 'time.now' | 'time.minutes' | 'time.hours' | 'time.days' {
  if (age.unit === 'minutes') return 'time.minutes';
  if (age.unit === 'hours') return 'time.hours';
  if (age.unit === 'days') return 'time.days';
  return 'time.now';
}
