import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  parsePairingUrl,
  type HistoryEntry,
  type HostInfo,
  type QuestionAnswerItem,
  type QuestionBatch,
  type SessionSummary,
} from '@dsh-mobile/protocol';
import { CompanionClient, endpointFromLocation, normalizeEndpoint } from './lib/connection.js';
import { classifyFailure, retryDelay } from './lib/reconnect.js';
import { storage } from './lib/storage.js';
import { QuestionsCard } from './components/Questions.js';
import { SessionView } from './components/SessionView.js';
import { SessionList } from './components/SessionList.js';
import { useI18n } from './i18n/index.js';
import { LOCALES, LOCALE_LABELS, type Locale } from './i18n/locales.js';

type View =
  | { kind: 'checking' }
  | { kind: 'pairing'; endpoint: string; notice?: string }
  | { kind: 'reconnecting'; endpoint: string; attempt: number; retryInMs: number }
  | { kind: 'connecting'; endpoint: string }
  | { kind: 'sessions'; endpoint: string; host: HostInfo; sessions: SessionSummary[] }
  | { kind: 'error'; endpoint: string; message: string };

export function App() {
  const { t, locale, setLocale } = useI18n();
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [code, setCode] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [questions, setQuestions] = useState<QuestionBatch[]>([]);
  const [openSession, setOpenSession] = useState<SessionSummary | undefined>(undefined);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const client = useMemo(() => ({ current: undefined as CompanionClient | undefined }), []);

  /** Failed attempts in a row. A ref: scheduling a retry must not re-render. */
  const retry = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** The open session, so it can be resubscribed after a reconnect. */
  const openSessionId = useRef<string | undefined>(undefined);
  const reopenRef = useRef<((sessionId: string) => Promise<void>) | undefined>(undefined);

  /** `start` calls itself to retry; the ref breaks the dependency cycle. */
  const startRef = useRef<((endpoint: string, pairingCode?: string) => Promise<void>) | undefined>(
    undefined,
  );

  /** Cancels any pending retry. Called when connecting or forgetting. */
  const cancelRetry = useCallback(() => {
    clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
  }, []);

  /**
   * Schedules one more attempt.
   *
   * The link drops all the time on a phone: it changes networks, the screen turns
   * off, the tailnet blips. Before this, any of those left an error screen whose
   * only button **deleted the pairing**.
   */
  const scheduleRetry = useCallback(
    (endpoint: string) => {
      // Un solo reloj por fallo. Un intento fallido avisa dos veces (el catch y el
      // cierre del socket); sin esta guarda el contador avanzaba de dos en dos y el
      // reintento manual se pisaba.
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

  /**
   * Decides what a failure means.
   *
   * The rule: **the token is only dropped when the host says it is no longer
   * valid**. Everything else keeps the pairing, because losing it costs a full
   * round trip to the desktop.
   */
  const handleFailure = useCallback(
    (error: unknown, endpoint: string) => {
      switch (classifyFailure(error)) {
        case 'auth':
          cancelRetry();
          storage.saveToken(undefined);
          setView({
            kind: 'pairing',
            endpoint,
            notice: 'The host no longer recognises this device. Pair it again.',
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

  /** Connects, optionally redeems a pairing code, and loads the session list. */
  const start = useCallback(
    async (endpoint: string, pairingCode?: string) => {
      // Any deliberate start cancels a pending retry: otherwise the timer fires
      // later and tears down the connection that just succeeded.
      cancelRetry();

      client.current?.close();
      const connection = new CompanionClient(endpoint);
      client.current = connection;
      setQuestions([]);
      setView({ kind: 'connecting', endpoint });

      // If the socket drops, retry. The pairing is never touched here.
      connection.onState((state) => {
        if (state.kind !== 'offline') return;
        scheduleRetry(endpoint);
      });

      // Se registra antes de pedir nada: los lotes llegan empujados detrás de la lista.
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
            // Fusiona por `seq`: un evento repetido tras reconectar no se pinta dos veces.
            previous.some((entry) => entry.seq === message.seq)
              ? previous
              : [...previous, { seq: message.seq, at: message.at, event: message.event }],
          );

          // La cabecera es **viva**. El estado llega dentro de la transcripción, no
          // en un mensaje aparte: sin esto se quedaba congelado en el de la última
          // lista hasta volver atrás.
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

        const sessions = await connection.listSessions();
        retry.current = 0;
        setView({ kind: 'sessions', endpoint, host: hello.host, sessions });

        // After a reconnect the open session must be resubscribed, or the
        // transcript stays frozen and stops receiving live events.
        const stillOpen = openSessionId.current;
        if (stillOpen) void reopenRef.current?.(stillOpen);
      } catch (error) {
        handleFailure(error, endpoint);
      }
    },
    [client, cancelRetry, handleFailure, scheduleRetry],
  );

  /**
   * Retries when the app comes back to the foreground.
   *
   * The phone suspends the tab when the screen turns off, so the socket is gone
   * by the time the user looks again. Without this they had to reload by hand —
   * and before, that cost the pairing.
   */
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

  /** A pending retry must not outlive the component, and neither must the socket. */
  useEffect(
    () => () => {
      clearTimeout(retryTimer.current);
      client.current?.close();
      client.current = undefined;
    },
    [client],
  );
  // The retry calls the current version of `start`, not a stale closure. Updated in
  // an effect: writing to a ref during render is a side effect React may repeat.
  useEffect(() => {
    startRef.current = start;
  }, [start]);

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

  /**
   * Reloads a session after reconnecting.
   *
   * It exists separately from `open` because `open` needs the full summary to
   * render the header, and after a reconnect all we have is the id. It also
   * starts from a clean transcript: the resubscription replays from the cursor,
   * so keeping the old entries would duplicate everything.
   */
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
        // The list still works; leaving the stale transcript would be worse.
        setEntries([]);
      } finally {
        setLoadingHistory(false);
      }
    },
    [client],
  );

  // El reintento usa la versión vigente, sin arrastrar una copia vieja.

  // The reconnect path calls the current version of `reopen`, not a stale one.
  useEffect(() => {
    reopenRef.current = reopen;
  }, [reopen]);

  /** Opens a session: history plus the live event stream. */
  const open = useCallback(
    async (session: SessionSummary) => {
      openSessionId.current = session.id;
      const connection = client.current;
      if (!connection) return;

      setOpenSession(session);
      setEntries([]);
      setHasMore(false);
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

  /** Página anterior del historial. */
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

  const stop = useCallback(async () => {
    const connection = client.current;
    if (!connection || !openSession) return;
    try {
      await connection.cancel(openSession.id);
    } catch (error) {
      setView({ kind: 'error', endpoint: connection.url, message: messageOf(error) });
    }
  }, [client, openSession]);

  // Arranque: un enlace de emparejamiento manda sobre todo lo demás.
  useEffect(() => {
    const pairing = parsePairingUrl(globalThis.location.href);

    if (pairing) {
      // El código no debe quedarse en la barra de direcciones.
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

  const refresh = async () => {
    const connection = client.current;
    if (!connection) return;
    try {
      const sessions = await connection.listSessions();
      setView((previous) => (previous.kind === 'sessions' ? { ...previous, sessions } : previous));
    } catch (error) {
      setView((previous) =>
        previous.kind === 'sessions'
          ? previous
          : { kind: 'error', endpoint: '', message: messageOf(error) },
      );
    }
  };

  /**
   * Forgets the device. This is the **only** deliberate way to lose the pairing.
   *
   * The retry is cancelled first, and the client is closed as intentional, so
   * neither schedules a reconnect for a device that no longer exists.
   */
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

  return (
    <main className="shell">
      <header className="head">
        <h1>DSH Mobile</h1>
        <p className="muted">{t('app.subtitle')}</p>
      </header>

      {view.kind === 'checking' && <section className="card">{t('state.checking')}</section>}

      {view.kind === 'connecting' && (
        <section className="card">
          <h2>{t('state.connecting')}</h2>
          <p className="muted">{view.endpoint}</p>
        </section>
      )}

      {view.kind === 'pairing' && (
        <section className="card">
          <h2>{t('state.pairing')}</h2>
          <p>
            Abre el QR en el escritorio y escanéalo con la cámara. Si no puedes, escribe el código y
            la dirección del host.
          </p>

          <label className="field">
            <span>{t('pairing.code')}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABCD1234…"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              inputMode="text"
            />
          </label>

          <label className="field">
            <span>{t('pairing.host')}</span>
            <input
              value={endpointInput || view.endpoint}
              onChange={(event) => setEndpointInput(event.target.value)}
              placeholder="wss://maquina.tailnet.ts.net/ws"
              autoCapitalize="none"
              autoComplete="url"
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
          {view.notice && <p className="error">{view.notice}</p>}
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
          {/* Forgetting the device is a separate decision: it used to be the only
              button, so a network failure cost a full re-pairing. */}
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
            />
          ) : (
            <section className="card">
              <div className="row">
                <h2>{t('sessions.title')}</h2>
                <button type="button" className="ghost" onClick={() => void refresh()}>
                  {t('sessions.refresh')}
                </button>
              </div>

              <SessionList sessions={view.sessions} onOpen={(session) => void open(session)} />

              <button type="button" className="ghost" onClick={forget}>
                {t('error.forget')}
              </button>
            </section>
          )}
        </>
      )}

      <footer className="foot">
        {/* Language lives in the footer on purpose: it is reachable before pairing,
            when a user who cannot read the screen has the most to gain from it. */}
        <label className="locale-picker">
          <span className="visually-hidden">Language</span>
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
  return 'Navegador';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
