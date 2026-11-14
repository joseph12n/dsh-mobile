import { PROBE_LOG_PATH, COMPANION_DIR, log } from './log.js';
import { DeviceRegistry } from './core/devices.js';
import { PairingService } from './core/pairing.js';
import { DevicesFile } from './persist/devices-file.js';
import { join } from 'node:path';
import { findWebRoot } from './routes/web-root.js';
import { resolvePublicOrigin, type ResolvedOrigin } from './public-origin.js';
import { listSessions } from './dsh/session-source.js';
import { answerQuestion, listPendingQuestions } from './dsh/questions.js';
import { cancelRun, readHistory, subscribeSession } from './dsh/transcript.js';
import { injectText } from './dsh/prompt.js';
import { buildPairingMessage } from './pairing-message.js';
import { qrText } from './qr-text.js';
import { buildPairingUrl } from '@deepseekharness-mobile/protocol';
import { openInBrowser } from './open-browser.js';
import { resolveSessionId } from './dsh/sessions.js';
import { hasWorkspaces, listWorkspaces } from './dsh/workspaces.js';
import {
  archiveSession,
  canArchiveSession,
  canCreateSession,
  canUnarchiveSession,
  createSession,
  unarchiveSession,
} from './dsh/lifecycle.js';
import { canListModels, canSelectModel, listModels, selectModel } from './dsh/models.js';
import { commandsAvailable, listCommands, runCommand } from './dsh/slash-commands.js';
import { activityAvailable, readSessionActivity } from './dsh/session-activity.js';
import {
  connectProvider,
  disconnectProvider,
  listProviders,
  providerConnectAvailable,
  providersAvailable,
  testProvider,
} from './dsh/providers.js';
import { createQuestionBridge } from './dsh/question-bridge.js';
import type { HostContext } from './host-api.js';
import { reportToLog, reportToText, runProbe, type ProbeReport } from './probe.js';
import { DEFAULT_PORT, startCompanionServer, type RunningServer } from './server.js';
import type { Capability } from '@deepseekharness-mobile/protocol';

export const name = 'dsh-mobile-companion';

export const inject = ['sessions', 'sessionProjections', 'commands'];

const COMMAND_DESCRIPTION = 'Pair your phone, or check the companion status';

export function apply(ctx: HostContext): void {
  log(`plugin loaded · evidence in ${PROBE_LOG_PATH}`);

  const disposers: Array<() => void> = [];

  const probe = (): ProbeReport => {
    const report = runProbe(ctx);
    reportToLog(report);
    return report;
  };

  let origin: ResolvedOrigin | undefined;
  let listeningPort: number | undefined;
  let listenerError: string | undefined;
  let runningServer: RunningServer | undefined;

  const questionBridge = createQuestionBridge(ctx, {
    push: (message) => runningServer?.broadcast(message),
    clients: () => runningServer?.clientCount() ?? 0,
  });
  disposers.push(() => questionBridge.dispose());

  const linkFor = (code: string): string => {
    const port = listeningPort ?? DEFAULT_PORT;
    return buildPairingUrl(origin?.origin ?? `http://127.0.0.1:${port}`, code);
  };

  const qrFor = (code: string): string | undefined => {
    try {
      return qrText(linkFor(code));
    } catch {
      return undefined;
    }
  };

  const openPairingPage = (): string => {
    const page = `${origin?.origin ?? `http://127.0.0.1:${listeningPort ?? DEFAULT_PORT}`}/pair`;

    void openInBrowser(page).then((abierto) => {
      if (!abierto) log(`could not open the browser at ${page}`);
    });

    return `Opening ${page} in the desktop browser.`;
  };

  const detectOrigin = async (port: number): Promise<void> => {
    try {
      origin = await resolvePublicOrigin(publicUrl, port);
      log(`public pairing origin: ${origin.origin} (${origin.source})`);
    } catch {}
  };

  if (ctx.commands) {
    const register = (): (() => void) =>
      ctx.commands!.register({
        name: 'mobile',
        description: COMMAND_DESCRIPTION,
        input: { hint: '[open|qr|link|status]' },
        handler: (invocation) => {
          const argument = (invocation.rawInput ?? '').trim().toLowerCase();

          if (argument === 'status' || argument === 'probe') {
            try {
              const report = probe();
              return {
                kind: 'success',
                text: `${reportToText(report)}\n\nFull evidence: ${PROBE_LOG_PATH}`,
              };
            } catch (error) {
              return { kind: 'error', text: `The probe failed: ${String(error)}` };
            }
          }

          try {
            const current = pairing.pending()[0] ?? pairing.issue();

            const wantsQr = argument === 'qr';
            const wantsLinkOnly = argument === 'link';

            const message = buildPairingMessage({
              code: current.code,
              expiresAt: current.expiresAt,
              origin,
              port: listeningPort,
              listenerError,
              fallbackPort: DEFAULT_PORT,
              qr: wantsQr ? qrFor(current.code) : undefined,
            });

            const opensBrowser = !wantsQr && !wantsLinkOnly && !listenerError;

            return {
              kind: message.compromised && listenerError ? 'error' : 'success',
              text: opensBrowser ? `${message.text}\n\n${openPairingPage()}` : message.text,
            };
          } catch (error) {
            return { kind: 'error', text: `Could not prepare the pairing: ${String(error)}` };
          }
        },
      });

    const registerSay = (): (() => void) =>
      ctx.commands!.register({
        name: 'mobile-say',
        description: 'Inject a message into a session through sessionController.prompt',
        input: { hint: '<sessionId> <text>' },
        handler: (invocation) => {
          const raw = (invocation.rawInput ?? '').trim();
          const split = raw.indexOf(' ');
          if (split <= 0) {
            return { kind: 'error', text: 'Usage: /mobile-say <sessionId> <text>' };
          }

          const resolution = resolveSessionId(ctx, raw.slice(0, split));
          if (!resolution.ok) return { kind: 'error', text: resolution.error };

          const text = raw.slice(split + 1).trim();
          log(`E0.3: injecting ${text.length} characters into ${resolution.id}`);

          void injectText(ctx, resolution.id, text).then((result) =>
            log(`E0.3 resultado: ok=${result.ok} · ${result.detail}`),
          );

          return {
            kind: 'success',
            text: `Send dispatched to ${resolution.id}. The result is in ${PROBE_LOG_PATH}.`,
          };
        },
      });

    try {
      if (typeof ctx.effect === 'function') {
        ctx.effect(function* () {
          yield register();
          yield registerSay();
        }, 'dsh-mobile commands');
      } else {
        disposers.push(register(), registerSay());
      }
    } catch (error) {
      log(`could not register the commands: ${String(error)}`);
    }
  } else {
    log('the commands service is not available; /mobile is disabled');
  }

  const pairing = new PairingService();
  const devices = new DeviceRegistry({
    persistence: new DevicesFile(join(COMPANION_DIR, 'devices.json')),
  });

  const portFromEnv = Number(process.env.DSH_MOBILE_PORT ?? '');
  const options = Number.isInteger(portFromEnv) && portFromEnv > 0 ? { port: portFromEnv } : {};
  const publicUrl = process.env.DSH_MOBILE_PUBLIC_URL?.trim();
  const webRoot = findWebRoot();
  log(webRoot ? `PWA served from ${webRoot}` : 'PWA not found; the host serves the API only');

  const limits = (): Capability[] => {
    const list: Capability[] = [];
    if (hasWorkspaces(ctx)) list.push('workspace.list');
    if (canCreateSession(ctx)) list.push('session.create');
    if (canArchiveSession(ctx)) list.push('workspace.archive');
    if (canUnarchiveSession(ctx)) list.push('workspace.unarchive');
    if (canListModels(ctx) && canSelectModel(ctx)) list.push('model.select');
    if (commandsAvailable(ctx)) list.push('command.run');
    if (activityAvailable(ctx)) list.push('session.activity');
    if (providersAvailable(ctx)) list.push('providers.list');
    if (providerConnectAvailable(ctx)) list.push('provider.connect');
    list.push('devices.manage');
    return list;
  };

  void startCompanionServer({
    pairing,
    devices,
    capabilities: limits,
    ...options,
    ...(publicUrl ? { publicUrl } : {}),
    ...(webRoot ? { webRoot } : {}),
    listSessions: async (options) => {
      const records = await listSessions(ctx, options);
      const counts = questionBridge.counts();
      for (const record of records) {
        const extra = counts.get(record.id) ?? 0;
        if (extra > 0) record.pendingQuestions += extra;
      }
      return records;
    },
    listWorkspaces: () => listWorkspaces(ctx),
    createSession: (request) => createSession(ctx, request),
    archiveSession: (request) => archiveSession(ctx, request),
    unarchiveSession: (request) => unarchiveSession(ctx, request),
    listModels: () => listModels(ctx),
    selectModel: (request) => selectModel(ctx, request),
    listQuestions: () => [...listPendingQuestions(ctx), ...questionBridge.pendingBatches()],
    listCommands: (sessionId) => listCommands(ctx, sessionId),
    runCommand: (input) => runCommand(ctx, input),
    readActivity: (sessionId) => readSessionActivity(ctx, sessionId),
    listProviders: () => listProviders(ctx),
    testProvider: (input) => testProvider(ctx, input),
    connectProvider: (input) => connectProvider(ctx, input),
    disconnectProvider: (input) => disconnectProvider(ctx, input),
    answerQuestion: (input) => questionBridge.answer(input) ?? answerQuestion(ctx, input),
    readHistory: (sessionId, options) => readHistory(ctx, sessionId, options),
    subscribeSession: (sessionId, options) => subscribeSession(ctx, sessionId, options),
    cancelRun: (sessionId) => cancelRun(ctx, sessionId),
    sendReply: async (sessionId, text) => {
      const result = await injectText(ctx, sessionId, text);
      return result.ok
        ? { ok: true }
        : { ok: false, code: 'bad-request' as const, message: result.detail };
    },
    report: () => probe(),
  })
    .then((running) => {
      runningServer = running;
      disposers.push(() => {
        runningServer = undefined;
        void running.close().catch(() => undefined);
      });

      listeningPort = running.port;
      log(`listener ready on port ${running.port} (try: GET /health)`);

      void detectOrigin(running.port);
    })
    .catch((error: unknown) => {
      listenerError = String(error);
      log(`could not open the listener: ${listenerError}`);
    });

  const timer = setTimeout(() => {
    try {
      probe();
    } catch (error) {
      log(`the startup probe failed: ${String(error)}`);
    }
  }, 2000);
  if (typeof timer.unref === 'function') timer.unref();

  ctx.effect?.(function* () {
    yield () => {
      clearTimeout(timer);
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch {}
      }
      log('plugin unloaded');
    };
  }, 'dsh-mobile lifecycle');
}
