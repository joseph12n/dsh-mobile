import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  parsePairingUrl,
  type HistoryEntry,
  type HostInfo,
  type ModelCatalog,
  type ModelSelection,
  type QuestionAnswerItem,
  type QuestionBatch,
  type SessionSummary,
  type Workspace,
} from '@dsh-mobile/protocol';
import {
  CompanionClient,
  ConnectionError,
  endpointFromLocation,
  normalizeEndpoint,
} from './lib/connection.js';
import { classifyFailure, retryDelay } from './lib/reconnect.js';
import { storage } from './lib/storage.js';
import { QuestionsCard } from './components/Questions.js';
import { SessionView } from './components/SessionView.js';
import { SessionList } from './components/SessionList.js';
import { Settings } from './components/Settings.js';
import { RefreshIcon } from './components/icons.js';
import { useI18n } from './i18n/index.js';
import { LOCALES, LOCALE_LABELS, type Locale, type MessageKey } from './i18n/locales.js';
import { CONTRASTS, useContrast, type Contrast } from './lib/contrast.js';
import { useFolderPreferences } from './lib/preferences.js';
import { usesFolders } from './lib/folders.js';

type View =
  | { kind: 'checking' }
  | {
      kind: 'pairing';
      endpoint: string;
      noticeKey?: MessageKey;
      notice?: string;
    }
  | { kind: 'reconnecting'; endpoint: string; attempt: number; retryInMs: number }
  | { kind: 'connecting'; endpoint: string }
  | {
      kind: 'sessions';
      endpoint: string;
      host: HostInfo;
      sessions: SessionSummary[];
      workspaces: Workspace[];
    }
  | { kind: 'error'; endpoint: string; message: string };

type ActionNotice = { key: MessageKey } | { text: string };

export function App() {
  const { t, locale, setLocale } = useI18n();
  const { contrast, setContrast } = useContrast();
  const { preferences, setPreferences } = useFolderPreferences();
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [code, setCode] = useState('');
  const [actionError, setActionError] = useState<ActionNotice | undefined>(undefined);
  const [creatingIn, setCreatingIn] = useState<string | undefined>(undefined);
  const [archiving, setArchiving] = useState<string | undefined>(undefined);
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [endpointInput, setEndpointInput] = useState('');
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>(undefined);
  const [questions, setQuestions] = useState<QuestionBatch[]>([]);
  const [openSession, setOpenSession] = useState<SessionSummary | undefined>(undefined);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const client = useMemo(() => ({ current: undefined as CompanionClient | undefined }), []);

  const retry = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openSessionId = useRef<string | undefined>(undefined);
  const reopenRef = useRef<((sessionId: string) => Promise<void>) | undefined>(undefined);

  const refreshSeq = useRef(0);

  const showArchivedRef = useRef(false);

  const startRef = useRef<((endpoint: string, pairingCode?: string) => Promise<void>) | undefined>(
    undefined,
  );

  const cancelRetry = useCallback(() => {
    clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
  }, []);

  const scheduleRetry = useCallback(
    (endpoint: string) => {
      if (retryTimer.current !== undefined) return;
      cancelRetry();

      const wait = retryDelay(retry.current);
      retry.current += 1;

      setView({ kind: 'reconnecting', endpoint, attempt: retry.current, retryInMs: wait });

      retryTimer.current = setTimeout(() => {
        retryTimer.current = undefined;
        void startRef.current?.(endpoint);
      }, wait);
    },
    [cancelRetry],
  );

  const handleFailure = useCallback(
    (error: unknown, endpoint: string) => {
      switch (classifyFailure(error)) {
        case 'auth':
          cancelRetry();
          storage.saveToken(undefined);
          setView({
            kind: 'pairing',
            endpoint,
            noticeKey: 'error.authLost',
          });
          return;

        case 'pairing':
          cancelRetry();
          setView({ kind: 'pairing', endpoint, notice: messageOf(error) });
          return;

        case 'fatal':
          cancelRetry();
          setView({ kind: 'error', endpoint, message: messageOf(error) });
          return;

        default:
          scheduleRetry(endpoint);
      }
    },
    [cancelRetry, scheduleRetry],
  );

  const start = useCallback(
    async (endpoint: string, pairingCode?: string) => {
      cancelRetry();

      client.current?.close();
      const connection = new CompanionClient(endpoint);
      client.current = connection;
      setQuestions([]);
      setView({ kind: 'connecting', endpoint });

      connection.onState((state) => {
        if (state.kind !== 'offline') return;
        scheduleRetry(endpoint);
      });

      connection.onPush((message) => {
        if (message.type === 'question.pending') {
          const incoming = message.question;
          setQuestions((previous) => [
            ...previous.filter((batch) => batch.callId !== incoming.callId),
            incoming,
          ]);
        } else if (message.type === 'question.settled') {
          setQuestions((previous) => previous.filter((batch) => batch.callId !== message.callId));
        } else if (message.type === 'session.event') {
          setEntries((previous) =>
            previous.some((entry) => entry.seq === message.seq)
              ? previous
              : [...previous, { seq: message.seq, at: message.at, event: message.event }],
          );

          if (message.event.kind === 'state') {
            const { sessionId, event } = message;
            const state = event.state;
            setOpenSession((previous) =>
              previous && previous.id === sessionId ? { ...previous, state } : previous,
            );
            setView((previous) =>
              previous.kind === 'sessions'
                ? {
                    ...previous,
                    sessions: previous.sessions.map((session) =>
                      session.id === sessionId ? { ...session, state } : session,
                    ),
                  }
                : previous,
            );
          }
        }
      });

      try {
        const token = storage.token();
        const hello = await connection.connect(pairingCode ? undefined : token);

        if (pairingCode) {
          const paired = await connection.pair(
            pairingCode,
            deviceName(),
            navigator.platform ?? 'web',
          );
          storage.saveToken(paired.deviceToken);
          storage.saveEndpoint(endpoint);
        }

        const sessions = await connection.listSessions(showArchivedRef.current);

        const workspaces = hello.host.capabilities.includes('workspace.list')
          ? await connection.listWorkspaces().catch(() => [])
          : [];

        retry.current = 0;
        setView({ kind: 'sessions', endpoint, host: hello.host, sessions, workspaces });

        if (hello.host.capabilities.includes('model.select')) {
          void connection
            .listModels()
            .then((loaded) => {
              if (client.current === connection) setCatalog(loaded);
            })
            .catch(() => setCatalog(undefined));
        } else {
          setCatalog(undefined);
        }

        const stillOpen = openSessionId.current;
        if (stillOpen) void reopenRef.current?.(stillOpen);
      } catch (error) {
        handleFailure(error, endpoint);
      }
    },
    [client, cancelRetry, handleFailure, scheduleRetry],
  );

  useEffect(() => {
    const resume = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (view.kind !== 'error' && view.kind !== 'reconnecting') return;
      retry.current = 0;
      void start(view.endpoint);
    };

    document.addEventListener('visibilitychange', resume);
    globalThis.addEventListener('online', resume);

    return () => {
      document.removeEventListener('visibilitychange', resume);
      globalThis.removeEventListener('online', resume);
    };
  }, [start, view]);

  useEffect(
    () => () => {
      clearTimeout(retryTimer.current);
      client.current?.close();
      client.current = undefined;
    },
    [client],
  );
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    if (wasOpen.current && openSession === undefined) {
      listHeadingRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = openSession !== undefined;
  }, [openSession]);

  const answer = useCallback(
    async (callId: string, sessionId: string, answers: QuestionAnswerItem[]) => {
      const connection = client.current;
      if (!connection) return;
      try {
        await connection.answer(callId, sessionId, answers);
        setQuestions((previous) => previous.filter((batch) => batch.callId !== callId));
      } catch (error) {
        setView({ kind: 'error', endpoint: connection.url, message: messageOf(error) });
      }
    },
    [client],
  );

  const reopen = useCallback(
    async (sessionId: string) => {
      const connection = client.current;
      if (!connection) return;

      setLoadingHistory(true);
      try {
        const page = await connection.history(sessionId, { limit: 40 });
        setEntries([...page.entries].sort((a, b) => a.seq - b.seq));
        setHasMore(page.hasMore);
        const last = page.entries.at(-1)?.seq ?? 0;
        await connection.subscribe(sessionId, last);
      } catch {
        setEntries([]);
      } finally {
        setLoadingHistory(false);
      }
    },
    [client],
  );

  useEffect(() => {
    reopenRef.current = reopen;
  }, [reopen]);

  const open = useCallback(
    async (session: SessionSummary) => {
      openSessionId.current = session.id;
      const connection = client.current;
      if (!connection) return;

      setOpenSession(session);
      setEntries([]);
      setHasMore(false);
      setModelError(undefined);
      setLoadingHistory(true);

      try {
        const page = await connection.history(session.id, { limit: 40 });
        setEntries([...page.entries].sort((a, b) => a.seq - b.seq));
        setHasMore(page.hasMore);
        await connection.subscribe(session.id, session.seq);
      } catch (error) {
        setView({ kind: 'error', endpoint: connection.url, message: messageOf(error) });
      } finally {
        setLoadingHistory(false);
      }
    },
    [client],
  );

  const loadMore = useCallback(async () => {
    const connection = client.current;
    if (!connection || !openSession || entries.length === 0) return;

    setLoadingHistory(true);
    try {
      const oldest = entries[0]!.seq;
      const page = await connection.history(openSession.id, { before: oldest, limit: 40 });
      setEntries((previous) =>
        [...page.entries, ...previous]
          .filter((entry, index, all) => all.findIndex((item) => item.seq === entry.seq) === index)
          .sort((a, b) => a.seq - b.seq),
      );
      setHasMore(page.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingHistory(false);
    }
  }, [client, openSession, entries]);

  const sendText = useCallback(
    async (text: string) => {
      const connection = client.current;
      if (!connection || !openSession) return;
      try {
        await connection.reply(openSession.id, text);
      } catch (error) {
        setView({ kind: 'error', endpoint: connection.url, message: messageOf(error) });
      }
    },
    [client, openSession],
  );

  const [modelError, setModelError] = useState<string | undefined>(undefined);

  const modelRequest = useRef(0);

  const changeModel = useCallback(
    async (selection: ModelSelection) => {
      const connection = client.current;
      if (!connection || !openSession) return;

      const sessionId = openSession.id;
      const request = ++modelRequest.current;

      try {
        const settled = await connection.selectModel(sessionId, selection);
        if (request !== modelRequest.current) return;

        setModelError(undefined);
        setOpenSession((previous) =>
          previous && previous.id === sessionId ? { ...previous, model: settled } : previous,
        );
        setView((previous) =>
          previous.kind === 'sessions'
            ? {
                ...previous,
                sessions: previous.sessions.map((session) =>
                  session.id === sessionId ? { ...session, model: settled } : session,
                ),
              }
            : previous,
        );
      } catch (error) {
        if (request !== modelRequest.current) return;

        if (error instanceof ConnectionError && error.code === 'bad-request') {
          void connection
            .listModels()
            .then(setCatalog)
            .catch(() => undefined);
        }
        setModelError(messageOf(error));
      }
    },
    [client, openSession],
  );

  const stop = useCallback(async () => {
    const connection = client.current;
    if (!connection || !openSession) return;
    try {
      await connection.cancel(openSession.id);
    } catch (error) {
      setView({ kind: 'error', endpoint: connection.url, message: messageOf(error) });
    }
  }, [client, openSession]);

  useEffect(() => {
    const pairing = parsePairingUrl(globalThis.location.href);

    if (pairing) {
      globalThis.history.replaceState(null, '', globalThis.location.pathname);
      const endpoint = normalizeEndpoint(pairing.e ?? endpointFromLocation());
      void start(endpoint, pairing.c);
      return;
    }

    const storedEndpoint = storage.endpoint();
    if (storage.token() && storedEndpoint) {
      void start(storedEndpoint);
      return;
    }

    setView({ kind: 'pairing', endpoint: endpointFromLocation() });
    setEndpointInput(endpointFromLocation());
  }, [start]);

  const createInFolder = async (workspaceId: string) => {
    const connection = client.current;
    if (!connection || creatingIn) return;

    setCreatingIn(workspaceId);
    try {
      const sessionId = await connection.createSession(workspaceId);
      setActionError(undefined);

      const sessions = await refresh();
      const created = sessions.find((session) => session.id === sessionId);
      if (created) void open(created);
    } catch (error) {
      setActionError({ text: messageOf(error) });
    } finally {
      setCreatingIn(undefined);
    }
  };

  const archive = async (session: SessionSummary) => {
    const connection = client.current;
    if (!connection || archiving) return;

    setArchiving(session.id);
    try {
      await connection.archiveSession(session.id);
      dropRow(session.id);
      setActionError(undefined);
    } catch (error) {
      const code = error instanceof ConnectionError ? error.code : undefined;
      if (code === 'not-found') {
        dropRow(session.id);
        setActionError(undefined);
      } else {
        setActionError(
          code === 'denied' ? { key: 'action.stopFirst' } : { text: messageOf(error) },
        );
      }
    } finally {
      try {
        await refresh();
      } catch (error) {
        setActionError({ text: messageOf(error) });
      } finally {
        setArchiving(undefined);
      }
    }
  };

  const dropRow = (sessionId: string) => {
    setView((previous) =>
      previous.kind === 'sessions'
        ? { ...previous, sessions: previous.sessions.filter((item) => item.id !== sessionId) }
        : previous,
    );
  };

  const refresh = async (): Promise<SessionSummary[]> => {
    const connection = client.current;
    if (!connection) return [];

    const generation = ++refreshSeq.current;
    const sessions = await connection.listSessions(showArchivedRef.current);
    const admiteCarpetas = connection.capabilities().includes('workspace.list');
    const workspaces = admiteCarpetas ? await connection.listWorkspaces().catch(() => []) : [];

    if (generation === refreshSeq.current) {
      setView((state) => (state.kind === 'sessions' ? { ...state, sessions, workspaces } : state));
    }
    return sessions;
  };

  const reload = async () => {
    try {
      await refresh();
      setActionError(undefined);
    } catch (error) {
      setActionError({ text: messageOf(error) });
    }
  };

  const toggleArchived = async () => {
    const next = !showArchived;
    showArchivedRef.current = next;
    setShowArchived(next);
    await reload();
  };

  const restore = async (session: SessionSummary) => {
    const connection = client.current;
    if (!connection || restoring) return;

    setRestoring(session.id);
    try {
      await connection.unarchive(session.id);
      setActionError(undefined);
    } catch (error) {
      setActionError({ text: messageOf(error) });
    } finally {
      try {
        await refresh();
      } catch (error) {
        setActionError({ text: messageOf(error) });
      } finally {
        setRestoring(undefined);
      }
    }
  };

  const forget = () => {
    cancelRetry();
    retry.current = 0;
    client.current?.close();
    client.current = undefined;
    openSessionId.current = undefined;
    storage.saveToken(undefined);
    storage.saveEndpoint(undefined);
    setView({ kind: 'pairing', endpoint: endpointFromLocation() });
  };

  const inConversation = view.kind === 'sessions' && openSession !== undefined;

  return (
    <main
      className={`shell${inConversation ? ' is-conversation' : ''}${view.kind === 'pairing' ? ' is-pairing' : ''}`}
    >
      <header className="head">
        <h1>DSH Mobile</h1>
        <p className="muted">{t('app.subtitle')}</p>
      </header>

      <div className="shell-body">
        {view.kind === 'checking' && <section className="card">{t('state.checking')}</section>}

        {view.kind === 'connecting' && (
          <section className="card">
            <h2>{t('state.connecting')}</h2>
            <p className="muted">{view.endpoint}</p>
          </section>
        )}

        {view.kind === 'pairing' && (
          <section className="card pairing-card">
            <h2>{t('state.pairing')}</h2>
            <p className="muted">{t('pairing.explain')}</p>

            <label className="field">
              <span>{t('pairing.code')}</span>
              <input
                className="code-input"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABCD1234"
                autoCapitalize="characters"
                autoComplete="one-time-code"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
              />
            </label>

            <label className="field">
              <span>{t('pairing.host')}</span>
              <input
                className="host-input"
                value={endpointInput || view.endpoint}
                onChange={(event) => setEndpointInput(event.target.value)}
                placeholder="wss://machine.tailnet.ts.net/ws"
                autoCapitalize="none"
                autoComplete="url"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
              />
            </label>

            <button
              type="button"
              disabled={!code.trim()}
              onClick={() =>
                void start(normalizeEndpoint(endpointInput || view.endpoint), code.trim())
              }
            >
              {t('pairing.submit')}
            </button>
            {(view.noticeKey || view.notice) && (
              <p className="error" role="alert">
                {view.noticeKey ? t(view.noticeKey) : view.notice}
              </p>
            )}
          </section>
        )}

        {view.kind === 'reconnecting' && (
          <section className="card">
            <h2>{t('state.reconnecting')}</h2>
            <p className="muted">
              {t('reconnect.kept')}{' '}
              {t('reconnect.attempt', {
                attempt: view.attempt,
                seconds: Math.round(view.retryInMs / 1000),
              })}
            </p>
            <p className="muted small">{view.endpoint}</p>
            <button type="button" onClick={() => void start(view.endpoint)}>
              {t('reconnect.now')}
            </button>
          </section>
        )}

        {view.kind === 'error' && (
          <section className="card">
            <h2>{t('state.error')}</h2>
            <p className="error">{view.message}</p>
            <button type="button" onClick={() => void start(view.endpoint)}>
              {t('error.retry')}
            </button>
            <button type="button" className="ghost" onClick={forget}>
              {t('error.forget')}
            </button>
          </section>
        )}

        {view.kind === 'sessions' && (
          <>
            <QuestionsCard
              questions={questions}
              titleFor={(id) => view.sessions.find((item) => item.id === id)?.title ?? id}
              onSubmit={(callId, sessionId, answers) => void answer(callId, sessionId, answers)}
            />

            {openSession ? (
              <SessionView
                session={openSession}
                entries={entries}
                hasMore={hasMore}
                loading={loadingHistory}
                onBack={() => {
                  openSessionId.current = undefined;
                  setOpenSession(undefined);
                  setEntries([]);
                }}
                onLoadMore={() => void loadMore()}
                onCancel={() => void stop()}
                onSend={(text) => void sendText(text)}
                {...(openSession.model ? { model: openSession.model } : {})}
                {...(catalog ? { catalog } : {})}
                {...(catalog
                  ? { onSelectModel: (selection: ModelSelection) => void changeModel(selection) }
                  : {})}
                {...(modelError ? { error: modelError } : {})}
              />
            ) : (
              <section className="card sessions-panel">
                <div className="row">
                  <h2 ref={listHeadingRef} tabIndex={-1}>
                    {t('sessions.title')}
                  </h2>
                  <div className="row-actions">
                    {view.host.capabilities.includes('workspace.unarchive') && (
                      <button
                        type="button"
                        className="ghost tiny"
                        aria-pressed={showArchived}
                        onClick={() => void toggleArchived()}
                      >
                        {t('sessions.archived')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost icon-button"
                      aria-label={t('sessions.refresh')}
                      onClick={() => void reload()}
                    >
                      <RefreshIcon />
                    </button>
                  </div>
                </div>

                {actionError && (
                  <p className="error" role="alert">
                    {'key' in actionError ? t(actionError.key) : actionError.text}
                  </p>
                )}

                {usesFolders(view.workspaces) && (
                  <Settings
                    workspaces={view.workspaces}
                    preferences={preferences}
                    onChange={setPreferences}
                  />
                )}

                <SessionList
                  sessions={view.sessions}
                  workspaces={view.workspaces}
                  onOpen={(session) => void open(session)}
                  onCreate={(workspaceId) => void createInFolder(workspaceId)}
                  onArchive={(session) => void archive(session)}
                  onUnarchive={(session) => void restore(session)}
                  canCreate={view.host.capabilities.includes('session.create')}
                  canArchive={view.host.capabilities.includes('workspace.archive')}
                  canUnarchive={view.host.capabilities.includes('workspace.unarchive')}
                  {...(creatingIn ? { createPending: creatingIn } : {})}
                  {...(archiving ? { archivePending: archiving } : {})}
                  {...(restoring ? { restorePending: restoring } : {})}
                  preferences={preferences}
                />

                <button type="button" className="ghost" onClick={forget}>
                  {t('error.forget')}
                </button>
              </section>
            )}
          </>
        )}
      </div>

      <footer className="foot">
        <label className="locale-picker">
          <span className="visually-hidden">{t('settings.language')}</span>
          <select
            className="locale"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
        </label>

        <label className="locale-picker">
          <span className="visually-hidden">{t('settings.contrast')}</span>
          <select
            className="locale"
            value={contrast}
            onChange={(event) => setContrast(event.target.value as Contrast)}
          >
            {CONTRASTS.map((level) => (
              <option key={level} value={level}>
                {t(`contrast.${level}`)}
              </option>
            ))}
          </select>
        </label>

        <span className="muted">
          {PROTOCOL_NAME} v{PROTOCOL_VERSION}
        </span>
      </footer>
    </main>
  );
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  return 'Browser';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
