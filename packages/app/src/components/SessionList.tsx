import { useState } from 'react';
import type { SessionSummary } from '@dsh-mobile/protocol';
import { groupSessions, elapsed } from '../lib/sessions.js';
import { plural, useI18n } from '../i18n/index.js';

/**
 * Session list, grouped by state.
 *
 * The order of the sections comes from `groupSessions`; this file only draws. The
 * "older" group starts collapsed because it is not what you look at when you pick up
 * the phone, and the others cannot be collapsed: if they are there, they matter.
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
  onOpen,
}: {
  sessions: SessionSummary[];
  onOpen: (session: SessionSummary) => void;
}) {
  const { t } = useI18n();
  const [showStale, setShowStale] = useState(false);

  if (sessions.length === 0) {
    return <p className="muted">{t('sessions.empty')}</p>;
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
                  // Only points at the group when it exists: an `aria-controls`
                  // referencing an unrendered element is a broken reference.
                  aria-controls={showStale ? `group-${section.kind}` : undefined}
                >
                  {showStale ? t('group.hide') : t('group.show')}
                </button>
              )}
            </header>

            {collapsed ? null : (
              <ul className="sessions" id={`group-${section.kind}`}>
                {section.sessions.map((session) => {
                  const age = elapsed(session.updatedAt);

                  return (
                    <li
                      key={session.id}
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
                        <span className={`badge ${session.state}`}>
                          {t(STATE_KEY[session.state])}
                        </span>
                        {session.pendingQuestions > 0 && (
                          <span className="badge waiting">
                            {plural(t, 'session.questionCount', session.pendingQuestions)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </>
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
