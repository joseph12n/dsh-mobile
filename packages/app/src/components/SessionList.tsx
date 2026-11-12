import { useState } from 'react';
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
}: {
  sessions: SessionSummary[];
  workspaces: Workspace[];
  onOpen: (session: SessionSummary) => void;
}) {
  const { t } = useI18n();
  const [showStale, setShowStale] = useState(false);

  if (sessions.length === 0) {
    return <p className="muted">{t('sessions.empty')}</p>;
  }

  const folders = groupByFolder(sessions, workspaces);

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
              </header>

              {empty ? (
                <p className="muted small">{t('group.emptyFolder')}</p>
              ) : (
                <ul className="sessions" id={`folder-${index}`}>
                  {section.sessions.map((session) => (
                    <SessionRow key={session.id} session={session} onOpen={onOpen} />
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
                  <SessionRow key={session.id} session={session} onOpen={onOpen} />
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
}: {
  session: SessionSummary;
  onOpen: (session: SessionSummary) => void;
}) {
  const { t } = useI18n();
  const age = elapsed(session.updatedAt);

  return (
    <li
      className="session-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(session)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        // Without this, Space also scrolls the page.
        event.preventDefault();
        onOpen(session);
      }}
    >
      <div className="session-main">
        <span className="session-title">{session.title}</span>
        <span className="muted small">
          {age ? t(unitKey(age), { count: 'count' in age ? age.count : 0 }) : ''}
        </span>
      </div>
      <div className="session-meta">
        <span className={`badge ${session.state}`}>{t(STATE_KEY[session.state])}</span>
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
