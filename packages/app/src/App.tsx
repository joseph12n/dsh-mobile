import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parsePairingUrl,
  type CommandInfo,
  type CommandResult,
  type DeviceInfo,
  type HistoryEntry,
  type HostInfo,
  type ModelCatalog,
  type ModelSelection,
  type ProviderTestResult,
  type ProviderView,
  type QuestionAnswerItem,
  type QuestionBatch,
  type SessionActivity,
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
import { backFrom, pushEntry, topEntry } from './lib/navigation.js';
import { storage } from './lib/storage.js';
import { QuestionsCard } from './components/Questions.js';
import { SessionView, type CatalogStatus } from './components/SessionView.js';
import { SessionList } from './components/SessionList.js';
import { SettingsSheet } from './components/SettingsSheet.js';
import { ForgetDeviceButton } from './components/ForgetDeviceButton.js';
import { GearIcon, RefreshIcon } from './components/icons.js';
import { useI18n } from './i18n/index.js';
import type { MessageKey } from './i18n/locales.js';
import { useFolderPreferences, toggleCollapsed } from './lib/preferences.js';

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

const QUESTIONS_POLL_MS = 6000;

export function App() {
  const { t } = useI18n();
  const { preferences, setPreferences } = useFolderPreferences();
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [code, setCode] = useState('');
  const [actionError, setActionError] = useState<ActionNotice | undefined>(undefined);
  const [creatingIn, setCreatingIn] = useState<string | undefined>(undefined);
  const [archiving, setArchiving] = useState<string | undefined>(undefined);
  const [restoring, setRestoring] = useState<string | undefined>(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endpointInput, setEndpointInput] = useState('');
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>(undefined);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('idle');
  const [questions, setQuestions] = useState<QuestionBatch[]>([]);
  const [device, setDevice] = useState<DeviceInfo | undefined>(undefined);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | undefined>(undefined);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | undefined>(undefined);
  const [openSession, setOpenSession] = useState<SessionSummary | undefined>(undefined);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [activity, setActivity] = useState<SessionActivity | undefined>(undefined);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasOpen = useRef(false);
  const questionsRef = useRef<QuestionBatch[]>([]);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const client = useMemo(() => ({ current: undefined as CompanionClient | undefined }), []);

  const retry = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openSessionId = useRef<string | undefined>(undefined);
  const reopenRef = useRef<((sessionId: string) => Promise<void>) | undefined>(undefined);
  const openSeq = useRef(0);

  const refreshSeq = useRef(0);
  const polling = useRef(false);

  const showArchivedRef = useRef(false);

  const startRef = useRef<((endpoint: string, pairingCode?: string) => Promise<void>) | undefined>(
    undefined,
  );
  const reloadRef = useRef<(() => Promise<void>) | undefined>(undefined);

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

  const updateSession = useCallback(
    (sessionId: string, patch: (session: SessionSummary) => Partial<SessionSummary>) => {
      setOpenSession((previous) =>
        previous && previous.id === sessionId ? { ...previous, ...patch(previous) } : previous,
      );
      setView((previous) =>
        previous.kind === 'sessions'
          ? {
              ...previous,
              sessions: previous.sessions.map((session) =>
                session.id === sessionId ? { ...session, ...patch(session) } : session,
              ),
            }
          : previous,
      );
    },
    [],
  );

  const loadModels = useCallback(async (connection: CompanionClient) => {
    setCatalogStatus('loading');
    try {
      const loaded = await connection.listModels();
      if (client.current !== connection) return;
      setCatalog(loaded);
      setCatalogStatus('ready');
    } catch {
      if (client.current !== connection) return;
      setCatalog(undefined);
      setCatalogStatus('error');
    }
  }, []);

  const reloadModels = (): void => {
    const connection = client.current;
    if (connection) void loadModels(connection);
  };

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
          const next = [
            ...questionsRef.current.filter((batch) => batch.callId !== incoming.callId),
            incoming,
          ];
          questionsRef.current = next;
          setQuestions(next);
          const pendingQuestions = next.filter(
            (batch) => batch.sessionId === incoming.sessionId,
          ).length;
          updateSession(incoming.sessionId, () => ({ pendingQuestions, state: 'waiting' }));
          return;
        }

        if (message.type === 'question.settled') {
          const next = questionsRef.current.filter((batch) => batch.callId !== message.callId);
          questionsRef.current = next;
          setQuestions(next);
          const pendingQuestions = next.filter(
            (batch) => batch.sessionId === message.sessionId,
          ).length;
          updateSession(message.sessionId, (session) => ({
            pendingQuestions,
            ...(pendingQuestions === 0 && session.state === 'waiting'
              ? { state: 'idle' as const }
              : {}),
          }));
          return;
        }

        if (message.type === 'devices.changed') {
          setDevices(message.devices);
          return;
        }

        if (message.type === 'session.state') {
          updateSession(message.sessionId, () => ({ state: message.state }));
          return;
        }

        if (message.type === 'session.event') {
          setEntries((previous) =>
            previous.some((entry) => entry.seq === message.seq)
              ? previous
              : [...previous, { seq: message.seq, at: message.at, event: message.event }],
          );
          updateSession(message.sessionId, () => ({
            updatedAt: message.at,
            ...(message.event.kind === 'state' ? { state: message.event.state } : {}),
          }));
        }
      });

      try {
        questionsRef.current = [];
        setQuestions([]);
        const token = storage.token();
        const hello = await connection.connect(pairingCode ? undefined : token);
        let currentDevice = hello.device;

        if (pairingCode) {
          const paired = await connection.pair(
            pairingCode,
            deviceName(),
            navigator.platform ?? 'web',
          );
          currentDevice = paired.device;
          storage.saveToken(paired.deviceToken);
          storage.saveEndpoint(endpoint);
        }

        if (client.current !== connection) return;
        setDevice(currentDevice);

        const sessions = await connection.listSessions(showArchivedRef.current);

        const workspaces = hello.host.capabilities.includes('workspace.list')
          ? await connection.listWorkspaces().catch(() => [])
          : [];

        if (client.current !== connection) return;
        retry.current = 0;
        setView({ kind: 'sessions', endpoint, host: hello.host, sessions, workspaces });

        if (hello.host.capabilities.includes('model.select')) {
          void loadModels(connection);
        } else {
          setCatalog(undefined);
          setCatalogStatus('idle');
        }

        const stillOpen = openSessionId.current;
        if (stillOpen) void reopenRef.current?.(stillOpen);
      } catch (error) {
        handleFailure(error, endpoint);
      }
    },
    [client, cancelRetry, handleFailure, scheduleRetry, updateSession, loadModels],
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
    const viewport = globalThis.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const apply = (): void => {
      root.style.setProperty('--viewport-height', `${Math.round(viewport.height)}px`);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      root.style.removeProperty('--viewport-height');
    };
  }, []);

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

        const remaining = questionsRef.current.filter((batch) => batch.callId !== callId);
        questionsRef.current = remaining;
        setQuestions(remaining);

        updateSession(sessionId, (session) => {
          const pendingQuestions = Math.max(0, session.pendingQuestions - 1);
          return {
            pendingQuestions,
            ...(pendingQuestions === 0 && session.state === 'waiting'
              ? { state: 'idle' as const }
              : {}),
          };
        });
      } catch (error) {
        setView({ kind: 'error', endpoint: connection.url, message: messageOf(error) });
      }
    },
    [client, updateSession],
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

  const leaveSession = useCallback(() => {
    openSeq.current += 1;
    openSessionId.current = undefined;
    setOpenSession(undefined);
    setEntries([]);
    setHasMore(false);
    setLoadingHistory(false);
  }, []);

  const open = useCallback(
    async (session: SessionSummary) => {
      const connection = client.current;
      if (!connection) return;

      const generation = ++openSeq.current;
      openSessionId.current = session.id;
      pushEntry(globalThis.history, { view: 'session', id: session.id });

      setOpenSession(session);
      setEntries([]);
      setHasMore(false);
      setModelError(undefined);
      setSendError(undefined);
      setLoadingHistory(true);

      try {
        const page = await connection.history(session.id, { limit: 40 });
        if (generation !== openSeq.current) return;

        setEntries([...page.entries].sort((a, b) => a.seq - b.seq));
        setHasMore(page.hasMore);
        await connection.subscribe(session.id, session.seq);
      } catch (error) {
        if (generation !== openSeq.current) return;
        setView({ kind: 'error', endpoint: connection.url, message: messageOf(error) });
      } finally {
        if (generation === openSeq.current) setLoadingHistory(false);
      }
    },
    [client],
  );

  useEffect(() => {
    const onPopState = (): void => {
      const entry = topEntry(globalThis.history);

      if (entry?.view === 'settings') {
        setSettingsOpen(true);
        return;
      }

      setSettingsOpen(false);
      if (entry?.view === 'session') return;
      leaveSession();
    };

    globalThis.addEventListener('popstate', onPopState);
    return () => globalThis.removeEventListener('popstate', onPopState);
  }, [leaveSession]);

  const devicesCapable =
    view.kind === 'sessions' && view.host.capabilities.includes('devices.manage');

  const providersCapable =
    view.kind === 'sessions' && view.host.capabilities.includes('providers.list');
  const providersConnectable =
    view.kind === 'sessions' && view.host.capabilities.includes('provider.connect');

  const loadProviders = useCallback(async () => {
    const connection = client.current;
    if (!connection || !providersCapable) {
      setProviders([]);
      return;
    }

    setProvidersLoading(true);
    try {
      setProviders(await connection.listProviders());
      setProvidersError(undefined);
    } catch (error) {
      setProviders([]);
      setProvidersError(messageOf(error));
    } finally {
      setProvidersLoading(false);
    }
  }, [client, providersCapable]);

  const testProvider = useCallback(
    async (provider: string, apiKey: string): Promise<ProviderTestResult | undefined> => {
      const connection = client.current;
      if (!connection) return undefined;

      try {
        return await connection.testProvider(provider, apiKey);
      } catch (error) {
        setProvidersError(messageOf(error));
        return undefined;
      }
    },
    [client],
  );

  const connectProvider = useCallback(
    async (provider: string, apiKey: string): Promise<{ ok: boolean; message?: string }> => {
      const connection = client.current;
      if (!connection) return { ok: false };

      try {
        await connection.connectProvider(provider, apiKey);
        await loadProviders();
        void loadModels(connection);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    },
    [client, loadProviders, loadModels],
  );

  const disconnectProvider = useCallback(
    async (provider: string): Promise<{ ok: boolean; message?: string }> => {
      const connection = client.current;
      if (!connection) return { ok: false };

      try {
        await connection.disconnectProvider(provider);
        await loadProviders();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    },
    [client, loadProviders],
  );

  const loadDevices = useCallback(async () => {
    const connection = client.current;
    if (!connection || !devicesCapable) {
      setDevices([]);
      return;
    }

    try {
      setDevices(await connection.listDevices());
      setDeviceError(undefined);
    } catch (error) {
      setDevices([]);
      setDeviceError(messageOf(error));
    }
  }, [client, devicesCapable]);

  const openSettings = useCallback(() => {
    if (topEntry(globalThis.history)?.view !== 'settings') {
      pushEntry(globalThis.history, { view: 'settings' });
    }
    setSettingsOpen(true);
    void loadDevices();
    void loadProviders();
  }, [loadDevices, loadProviders]);

  const revokeDevice = useCallback(
    async (deviceId: string) => {
      const connection = client.current;
      if (!connection) return;

      try {
        await connection.revokeDevice(deviceId);
        await loadDevices();
      } catch (error) {
        setDeviceError(messageOf(error));
      }
    },
    [client, loadDevices],
  );

  const closeSettings = useCallback(() => {
    if (backFrom(globalThis.history, { view: 'settings' })) return;
    setSettingsOpen(false);
  }, []);

  const commandCapable = view.kind === 'sessions' && view.host.capabilities.includes('command.run');
  const activityCapable =
    view.kind === 'sessions' && view.host.capabilities.includes('session.activity');

  useEffect(() => {
    const connection = client.current;
    const sessionId = openSession?.id;
    if (!connection || !sessionId || !commandCapable) {
      setCommands([]);
      return;
    }

    let cancelled = false;
    void connection
      .listCommands(sessionId)
      .then((list) => {
        if (!cancelled) setCommands(list);
      })
      .catch(() => {
        if (!cancelled) setCommands([]);
      });

    return () => {
      cancelled = true;
    };
  }, [client, commandCapable, openSession?.id]);

  const runOpenCommand = useCallback(
    async (line: string): Promise<CommandResult | undefined> => {
      const connection = client.current;
      const sessionId = openSession?.id;
      if (!connection || !sessionId) return { kind: 'error', text: 'The session is not open.' };

      try {
        return await connection.runCommand(sessionId, line);
      } catch (error) {
        return { kind: 'error', text: messageOf(error) };
      }
    },
    [client, openSession?.id],
  );

  const commandProps = commandCapable ? { commands, onRunCommand: runOpenCommand } : {};

  useEffect(() => {
    const connection = client.current;
    const sessionId = openSession?.id;
    if (!connection || !sessionId || !activityCapable) {
      setActivity(undefined);
      return;
    }

    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const next = await connection.activity(sessionId);
        if (!cancelled) setActivity(next);
      } catch {}
    };

    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, QUESTIONS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activityCapable, client, openSession?.id]);

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

  const [sendError, setSendError] = useState<string | undefined>(undefined);

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      const connection = client.current;
      if (!connection || !openSession) return false;
      setSendError(undefined);
      try {
        await connection.reply(openSession.id, text);
        return true;
      } catch (error) {
        setSendError(messageOf(error));
        return false;
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
          void loadModels(connection);
        }
        setModelError(messageOf(error));
      }
    },
    [client, openSession, loadModels],
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

  useEffect(() => {
    reloadRef.current = reload;
  });

  useEffect(() => {
    if (view.kind !== 'sessions') return;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void reloadRef.current?.();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [view.kind]);

  const pollQuestions = useCallback(async () => {
    const connection = client.current;
    if (!connection || document.visibilityState !== 'visible' || polling.current) return;

    polling.current = true;
    try {
      const sessions = await connection.listSessions(showArchivedRef.current);
      if (client.current !== connection) return;

      setView((previous) => (previous.kind === 'sessions' ? { ...previous, sessions } : previous));
      setOpenSession((previous) => {
        if (!previous) return previous;
        const fresh = sessions.find((session) => session.id === previous.id);
        return fresh ? { ...previous, ...fresh } : previous;
      });

      const busy = new Set(
        sessions.filter((session) => session.pendingQuestions > 0).map((session) => session.id),
      );
      const alive = questionsRef.current.filter((batch) => busy.has(batch.sessionId));
      if (alive.length !== questionsRef.current.length) {
        questionsRef.current = alive;
        setQuestions(alive);
      }
    } catch {
    } finally {
      polling.current = false;
    }
  }, [client]);

  useEffect(() => {
    if (view.kind !== 'sessions') return;

    const timer = setInterval(() => {
      void pollQuestions();
    }, QUESTIONS_POLL_MS);

    return () => clearInterval(timer);
  }, [pollQuestions, view.kind]);

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

  const forget = async (): Promise<void> => {
    const connection = client.current;
    const currentId = device?.id;
    if (connection && currentId && devicesCapable) {
      try {
        await Promise.race([
          connection.revokeDevice(currentId),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch {}
    }

    cancelRetry();
    retry.current = 0;
    client.current?.close();
    client.current = undefined;
    openSessionId.current = undefined;
    storage.saveToken(undefined);
    storage.saveEndpoint(undefined);
    setDevice(undefined);
    setDevices([]);
    setDeviceError(undefined);
    setSettingsOpen(false);
    if (topEntry(globalThis.history)?.view === 'settings') globalThis.history.back();
    setView({ kind: 'pairing', endpoint: endpointFromLocation() });
  };

  const inConversation = view.kind === 'sessions' && openSession !== undefined;
  const connected = view.kind === 'sessions';
  const shownEndpoint = view.kind === 'checking' ? endpointFromLocation() : view.endpoint;

  return (
    <main
      className={`shell${inConversation ? ' is-conversation' : ''}${view.kind === 'pairing' ? ' is-pairing' : ''}`}
    >
      <header className="head">
        <div className="head-ident">
          <h1>DSH Mobile</h1>
          <p className="muted">{t('app.subtitle')}</p>
        </div>
        {!inConversation && (
          <button
            type="button"
            className="ghost icon-button head-action"
            aria-label={t('settings.open')}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={openSettings}
          >
            <GearIcon />
          </button>
        )}
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
            <p className="error" role="alert">
              {view.message}
            </p>
            {view.endpoint && <p className="muted small">{view.endpoint}</p>}
            <div className="stack">
              <button type="button" onClick={() => void start(view.endpoint)}>
                {t('error.retry')}
              </button>
              <ForgetDeviceButton onForget={forget} />
            </div>
          </section>
        )}

        {view.kind === 'sessions' && (
          <>
            {!openSession && (
              <QuestionsCard
                questions={questions}
                titleFor={(id) => view.sessions.find((item) => item.id === id)?.title ?? id}
                onSubmit={(callId, sessionId, answers) => void answer(callId, sessionId, answers)}
              />
            )}

            {openSession ? (
              <SessionView
                session={openSession}
                entries={entries}
                hasMore={hasMore}
                loading={loadingHistory}
                {...commandProps}
                {...(activity ? { activity } : {})}
                questions={questions.filter((batch) => batch.sessionId === openSession.id)}
                onAnswerQuestion={(callId, sessionId, answers) =>
                  void answer(callId, sessionId, answers)
                }
                onBack={() => {
                  if (backFrom(globalThis.history, { view: 'session', id: openSession.id })) return;
                  leaveSession();
                }}
                onLoadMore={() => void loadMore()}
                onCancel={() => void stop()}
                onSend={sendText}
                {...(sendError ? { sendError } : {})}
                {...(openSession.model ? { model: openSession.model } : {})}
                {...(view.host.capabilities.includes('model.select')
                  ? {
                      onSelectModel: (selection: ModelSelection) => void changeModel(selection),
                      catalogStatus,
                      onReloadModels: reloadModels,
                      ...(catalog ? { catalog } : {}),
                    }
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

                <SessionList
                  sessions={view.sessions}
                  workspaces={view.workspaces}
                  onOpen={(session) => void open(session)}
                  onCreate={(workspaceId) => void createInFolder(workspaceId)}
                  onArchive={(session) => void archive(session)}
                  onUnarchive={(session) => void restore(session)}
                  onToggleFolder={(workspaceId) =>
                    setPreferences(toggleCollapsed(preferences, workspaceId))
                  }
                  canCreate={view.host.capabilities.includes('session.create')}
                  canArchive={view.host.capabilities.includes('workspace.archive')}
                  canUnarchive={view.host.capabilities.includes('workspace.unarchive')}
                  {...(creatingIn ? { createPending: creatingIn } : {})}
                  {...(archiving ? { archivePending: archiving } : {})}
                  {...(restoring ? { restorePending: restoring } : {})}
                  preferences={preferences}
                />
              </section>
            )}
          </>
        )}
      </div>

      <SettingsSheet
        open={settingsOpen}
        onClose={closeSettings}
        connected={connected}
        workspaces={view.kind === 'sessions' ? view.workspaces : []}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        hostName={view.kind === 'sessions' ? view.host.name : ''}
        endpoint={shownEndpoint}
        devices={devices}
        {...(device ? { currentDeviceId: device.id } : {})}
        canManageDevices={devicesCapable}
        onRevokeDevice={(deviceId) => void revokeDevice(deviceId)}
        {...(deviceError ? { deviceError } : {})}
        providers={providers}
        providersLoading={providersLoading}
        {...(providersError ? { providersError } : {})}
        canListProviders={providersCapable}
        canConnectProviders={providersConnectable}
        onTestProvider={testProvider}
        onConnectProvider={connectProvider}
        onDisconnectProvider={disconnectProvider}
        onForget={forget}
      />
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
