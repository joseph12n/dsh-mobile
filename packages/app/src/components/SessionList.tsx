import { useId, useState } from 'react';
import type { SessionSummary, Workspace } from '@dsh-mobile/protocol';
import { groupSessions, elapsed } from '../lib/sessions.js';
import { displayTitle, groupByFolder, usesFolders } from '../lib/folders.js';
import { folderView, type FolderPreferences } from '../lib/preferences.js';
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
  onUnarchive,
  canCreate = false,
  canArchive = false,
  canUnarchive = false,
  createPending,
  archivePending,
  restorePending,
  preferences,
}: {
  sessions: SessionSummary[];
  workspaces: Workspace[];
  onOpen: (session: SessionSummary) => void;
  /** Creates a session in that folder. Absent when the host cannot. */
  onCreate?: (workspaceId: string) => void;
  onArchive?: (session: SessionSummary) => void;
  /** Brings an archived session back. Absent when the host cannot. */
  onUnarchive?: (session: SessionSummary) => void;
  canCreate?: boolean;
  canArchive?: boolean;
  canUnarchive?: boolean;
  /** Folder whose create is in flight. Its button is disabled until it settles. */
  createPending?: string;
  /** Session whose archive is in flight, for the same reason. */
  archivePending?: string;
  /** Session whose restore is in flight. */
  restorePending?: string;
  /** How the user wants the folders shown. Without them, the host order. */
  preferences?: FolderPreferences;
}) {
  const { t, locale } = useI18n();
  const [showStale, setShowStale] = useState(false);

  const grouped = groupByFolder(sessions, workspaces);
  const view = preferences
    ? folderView(grouped, preferences, locale)
    : { state: 'folders' as const, sections: grouped };

  // Sin carpetas y sin sesiones, el aviso. Con carpetas, se pintan igual: es donde
  // irían las sesiones nuevas y esconderlas borraba la agrupación entera.
  if (sessions.length === 0 && !usesFolders(workspaces)) {
    return <p className="muted">{t('sessions.empty')}</p>;
  }

  // Solo se avisa cuando no hay nada que pintar y el motivo es que el usuario ocultó
  // las carpetas. Si no queda ninguna por «ocultar vacías», se muestran igual.
  if (view.state === 'all-hidden') {
    return <p className="muted">{t('settings.allHidden')}</p>;
  }

  const folders = view.sections;

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
                      {...(onUnarchive ? { onUnarchive } : {})}
                      canArchive={canArchive}
                      canUnarchive={canUnarchive}
                      {...(archivePending ? { archivePending } : {})}
                      {...(restorePending ? { restorePending } : {})}
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
                    {...(onUnarchive ? { onUnarchive } : {})}
                    canArchive={canArchive}
                    canUnarchive={canUnarchive}
                    {...(archivePending ? { archivePending } : {})}
                    {...(restorePending ? { restorePending } : {})}
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
  onUnarchive,
  canArchive,
  canUnarchive,
  archivePending,
  restorePending,
}: {
  session: SessionSummary;
  onOpen: (session: SessionSummary) => void;
  onArchive?: (session: SessionSummary) => void;
  onUnarchive?: (session: SessionSummary) => void;
  canArchive: boolean;
  canUnarchive: boolean;
  /** Sesión cuyo archivo está en vuelo: su botón se deshabilita. */
  archivePending?: string;
  /** Sesión cuya restauración está en vuelo. */
  restorePending?: string;
}) {
  const { t } = useI18n();
  const age = elapsed(session.updatedAt);
  const stateId = useId();
  const archived = session.archived === true;

  return (
    <li className="session-row">
      {/* Un botón de verdad, no un `li` con `role="button"`: dentro vive otro botón
          y las interacciones anidadas confundían a los lectores de pantalla.
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
        {archived
          ? canUnarchive &&
            onUnarchive && (
              <button
                type="button"
                className="ghost tiny"
                aria-label={`${t('action.restore')}: ${session.title}`}
                disabled={restorePending !== undefined}
                onClick={() => onUnarchive(session)}
              >
                {t('action.restore')}
              </button>
            )
          : canArchive &&
            onArchive && (
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
        {archived && <span className="badge archived">{t('sessions.archived')}</span>}
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
