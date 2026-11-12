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
import {
  CompanionClient,
  endpointFromLocation,
  isAuthFailure,
  normalizeEndpoint,
} from './lib/connection.js';
import { storage } from './lib/storage.js';
import { QuestionsCard } from './components/Questions.js';
import { SessionView } from './components/SessionView.js';
import { SessionList } from './components/SessionList.js';

type View =
  | { kind: 'checking' }
  | { kind: 'pairing'; endpoint: string; notice?: string }
  | { kind: 'reconnecting'; endpoint: string; attempt: number; retryInMs: number }
  | { kind: 'connecting'; endpoint: string }
  | { kind: 'sessions'; endpoint: string; host: HostInfo; sessions: SessionSummary[] }
  | { kind: 'error'; endpoint: string; message: string };

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

  /**
   * Intentos fallidos seguidos. Vive en un `ref` para que el reintento no dependa
   * de volver a renderizar, y para poder reiniciarlo al conectar.
   */
  const retry = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Espera entre reintentos: 1, 2, 4, 8, 15 y como mucho 30 segundos. */
  const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

  /**
   * Programa otro intento.
   *
   * La conexión se pierde sola todo el rato: el móvil cambia de red, se apaga la
   * pantalla, el tailnet parpadea. Antes eso dejaba una pantalla de error cuyo
   * único botón **borraba el emparejamiento**, así que cada bache costaba volver a
   * emparejar desde cero.
   */
  const scheduleRetry = useCallback((endpoint: string) => {
    clearTimeout(retryTimer.current);

    const intento = Math.min(retry.current, RETRY_DELAYS_MS.length - 1);
    const espera = RETRY_DELAYS_MS[intento] ?? 30_000;
    retry.current += 1;

    setView({ kind: 'reconnecting', endpoint, attempt: retry.current, retryInMs: espera });

    retryTimer.current = setTimeout(() => {
      void startRef.current?.(endpoint);
    }, espera);
  }, []);

  // `start` se referencia a sí mismo para el reintento; el `ref` evita la
  // dependencia circular entre ambos `useCallback`.
  const startRef = useRef<((endpoint: string, pairingCode?: string) => Promise<void>) | undefined>(
    undefined,
  );

  /** Conecta, opcionalmente empareja con un código, y carga sesiones. */
  const start = useCallback(
    async (endpoint: string, pairingCode?: string) => {
      client.current?.close();
      const connection = new CompanionClient(endpoint);
      client.current = connection;
      setQuestions([]);
      setView({ kind: 'connecting', endpoint });

      // Si el socket se cae, se reintenta: el emparejamiento no se toca.
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
      } catch (error) {
        // Un fallo de red se reintenta: el emparejamiento no se toca. Solo se
        // vuelve a emparejar si el host dice que el token ya no vale.
        if (isAuthFailure(error)) {
          storage.saveToken(undefined);
          setView({
            kind: 'pairing',
            endpoint,
            notice: 'El host ya no reconoce este dispositivo. Vuelve a emparejarlo.',
          });
          return;
        }

        scheduleRetry(endpoint);
      }
    },
    // `scheduleRetry` y `forget` se definen con `useCallback` más abajo y son
    // estables; incluidas aquí para no capturar una versión vieja.
    [client, scheduleRetry],
  );

  // El reintento llama a la versión vigente de start.
  startRef.current = start;

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
          {view.notice && <p className="error">{view.notice}</p>}
        </section>
      )}

      {view.kind === 'reconnecting' && (
        <section className="card">
          <h2>Reconectando…</h2>
          <p className="muted">
            El emparejamiento sigue guardado. Intento {view.attempt}, reintento en{' '}
            {Math.round(view.retryInMs / 1000)} s.
          </p>
          <p className="muted small">{view.endpoint}</p>
          <button type="button" onClick={() => void start(view.endpoint)}>
            Reintentar ahora
          </button>
        </section>
      )}

      {view.kind === 'error' && (
        <section className="card">
          <h2>No pude conectar</h2>
          <p className="error">{view.message}</p>
          <button type="button" onClick={() => void start(view.endpoint)}>
            Reintentar
          </button>
          {/* Olvidar el dispositivo es una decisión aparte: antes era el ÚNICO
              botón, así que un fallo de red costaba volver a emparejar. */}
          <button type="button" className="ghost" onClick={forget}>
            Olvidar este dispositivo
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
                <h2>Sesiones</h2>
                <button type="button" className="ghost" onClick={() => void refresh()}>
                  Actualizar
                </button>
              </div>

              <SessionList sessions={view.sessions} onOpen={(session) => void open(session)} />

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
