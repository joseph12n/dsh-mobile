import { useId, useState } from 'react';
import type { SessionSummary, Workspace } from '@dsh-mobile/protocol';
import { groupSessions, elapsed } from '../lib/sessions.js';
import { displayTitle, groupByFolder, usesFolders } from '../lib/folders.js';
import { folderView, type FolderPreferences } from '../lib/preferences.js';
import { plural, useI18n } from '../i18n/index.js';

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
  onCreate?: (workspaceId: string) => void;
  onArchive?: (session: SessionSummary) => void;
  onUnarchive?: (session: SessionSummary) => void;
  canCreate?: boolean;
  canArchive?: boolean;
  canUnarchive?: boolean;
  createPending?: string;
  archivePending?: string;
  restorePending?: string;
  preferences?: FolderPreferences;
}) {
  const { t, locale } = useI18n();
  const [showStale, setShowStale] = useState(false);

  const grouped = groupByFolder(sessions, workspaces);
  const view = preferences
    ? folderView(grouped, preferences, locale)
    : { state: 'folders' as const, sections: grouped };

  if (sessions.length === 0 && !usesFolders(workspaces)) {
    return <p className="muted">{t('sessions.empty')}</p>;
  }

  if (view.state === 'all-hidden') {
    return <p className="muted">{t('settings.allHidden')}</p>;
  }

  const folders = view.sections;

  if (usesFolders(workspaces)) {
    return (
      <>
        {folders.map((section, index) => {
          const id = section.workspace?.id ?? 'no-folder';
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
        const collapsed =
          section.kind === 'stale' &&
          !showStale &&
          !section.sessions.some((session) => session.archived === true);

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
  archivePending?: string;
  restorePending?: string;
}) {
  const { t } = useI18n();
  const age = elapsed(session.updatedAt);
  const stateId = useId();
  const archivedId = useId();
  const archived = session.archived === true;

  return (
    <li className="session-row">
      <button
        type="button"
        className="session-open"
        aria-describedby={archived ? `${stateId} ${archivedId}` : stateId}
        onClick={() => onOpen(session)}
      >
        <span className="session-title">{session.title}</span>
        <span className="muted small">
          {age ? t(unitKey(age), { count: 'count' in age ? age.count : 0 }) : ''}
        </span>
      </button>
      <div className="session-meta">
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
                disabled={restorePending === session.id}
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
                disabled={archivePending === session.id}
                onClick={() => onArchive(session)}
              >
                {t('action.archive')}
              </button>
            )}
        {archived && (
          <span id={archivedId} className="badge archived">
            {t('action.archived')}
          </span>
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

function unitKey(age: {
  unit: 'now' | 'minutes' | 'hours' | 'days';
}): 'time.now' | 'time.minutes' | 'time.hours' | 'time.days' {
  if (age.unit === 'minutes') return 'time.minutes';
  if (age.unit === 'hours') return 'time.hours';
  if (age.unit === 'days') return 'time.days';
  return 'time.now';
}
