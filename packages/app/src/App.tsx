import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { storage } from './lib/storage.js';
import { QuestionsCard } from './components/Questions.js';
import { SessionView } from './components/SessionView.js';

type View =
  | { kind: 'checking' }
  | { kind: 'pairing'; endpoint: string; message?: string }
  | { kind: 'connecting'; endpoint: string }
  | { kind: 'sessions'; endpoint: string; host: HostInfo; sessions: SessionSummary[] }
  | { kind: 'error'; endpoint: string; message: string };

/** "hace 3 min", suficiente para ordenar mentalmente la lista. */
function relativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'ahora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

const STATE_LABEL: Record<SessionSummary['state'], string> = {
  working: 'trabajando',
  waiting: 'espera respuesta',
  idle: 'en reposo',
  done: 'terminada',
  error: 'error',
};

export function App() {
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [code, setCode] = useState('');
  const [endpointInput, setEndpointInput] = useState('');
  const [questions, setQuestions] = useState<QuestionBatch[]>([]);
  const [openSession, setOpenSession] = useState<SessionSummary | undefined>(undefined);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const client = useMemo(() => ({ current: undefined as CompanionClient | undefined }), []);

  /** Conecta, opcionalmente empareja con un código, y carga sesiones. */
  const start = useCallback(
    async (endpoint: string, pairingCode?: string) => {
      client.current?.close();
      const connection = new CompanionClient(endpoint);
      client.current = connection;
      setQuestions([]);
      setView({ kind: 'connecting', endpoint });

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
        setView({ kind: 'sessions', endpoint, host: hello.host, sessions });
      } catch (error) {
        setView({ kind: 'error', endpoint, message: messageOf(error) });
      }
    },
    [client],
  );

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

  /** Abre una sesión: historial y flujo de eventos. */
  const open = useCallback(
    async (session: SessionSummary) => {
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

  const forget = () => {
    client.current?.close();
    storage.saveToken(undefined);
    storage.saveEndpoint(undefined);
    setView({ kind: 'pairing', endpoint: endpointFromLocation() });
  };

  return (
    <main className="shell">
      <header className="head">
        <h1>DSH Mobile</h1>
        <p className="muted">Control remoto de DeepSeek Harness</p>
      </header>

      {view.kind === 'checking' && <section className="card">Comprobando…</section>}

      {view.kind === 'connecting' && (
        <section className="card">
          <h2>Conectando</h2>
          <p className="muted">{view.endpoint}</p>
        </section>
      )}

      {view.kind === 'pairing' && (
        <section className="card">
          <h2>Sin emparejar</h2>
          <p>
            Abre el QR en el escritorio y escanéalo con la cámara. Si no puedes, escribe el código y
            la dirección del host.
          </p>

          <label className="field">
            <span>Código</span>
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
            <span>Host</span>
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
            Emparejar
          </button>
          {view.message && <p className="error">{view.message}</p>}
        </section>
      )}

      {view.kind === 'error' && (
        <section className="card">
          <h2>No pude conectar</h2>
          <p className="error">{view.message}</p>
          <button type="button" onClick={forget}>
            Volver a emparejar
          </button>
        </section>
      )}

      {view.kind === 'sessions' && (
        <>
          <QuestionsCard
            questions={questions}
            onSubmit={(callId, sessionId, answers) => void answer(callId, sessionId, answers)}
          />

          {openSession ? (
            <SessionView
              session={openSession}
              entries={entries}
              hasMore={hasMore}
              loading={loadingHistory}
              onBack={() => {
                setOpenSession(undefined);
                setEntries([]);
              }}
              onLoadMore={() => void loadMore()}
              onCancel={() => void stop()}
            />
          ) : (
            <section className="card">
              <div className="row">
                <h2>Sesiones</h2>
                <button type="button" className="ghost" onClick={() => void refresh()}>
                  Actualizar
                </button>
              </div>

              {view.sessions.length === 0 ? (
                <p className="muted">No hay sesiones vivas en el host.</p>
              ) : (
                <ul className="sessions">
                  {view.sessions.map((session) => (
                    <li
                      key={session.id}
                      className="session-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => void open(session)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') void open(session);
                      }}
                    >
                      <div className="session-main">
                        <span className="session-title">{session.title}</span>
                        <span className="muted small">{relativeTime(session.updatedAt)}</span>
                      </div>
                      <div className="session-meta">
                        <span className={`badge ${session.state}`}>
                          {STATE_LABEL[session.state]}
                        </span>
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

              <button type="button" className="ghost" onClick={forget}>
                Olvidar este dispositivo
              </button>
            </section>
          )}
        </>
      )}

      <footer className="foot">
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
