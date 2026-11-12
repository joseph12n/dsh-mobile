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
import { buildPairingUrl } from '@dsh-mobile/protocol';
import { openInBrowser } from './open-browser.js';
import { resolveSessionId } from './dsh/sessions.js';
import { hasWorkspaces, listWorkspaces } from './dsh/workspaces.js';
import type { HostContext } from './host-api.js';
import { reportToLog, reportToText, runProbe, type ProbeReport } from './probe.js';
import { DEFAULT_PORT, startCompanionServer } from './server.js';
import type { Capability } from '@dsh-mobile/protocol';

/**
 * dsh-mobile companion — plugin host.
 *
 * Estado actual: **spike de Fase 0**. No es el producto todavía. Sirve para
 * responder con evidencia si un plugin puede ver sesiones, leer la proyección de
 * preguntas y abrir su propio listener. Todo lo que falla se registra; nunca se
 * propaga al host.
 */

export const name = 'dsh-mobile-companion';

/**
 * Servicios que el plugin necesita. Cordis no activa el plugin hasta que están
 * montados, así que dentro de `apply` se pueden usar sin comprobaciones de
 * carrera (aun así se accede de forma defensiva).
 */
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

  // --- Emparejamiento bajo demanda ---------------------------------------------
  // El origen público se resuelve en segundo plano: consultar Tailscale no debe
  // bloquear la carga del plugin.
  let origin: ResolvedOrigin | undefined;
  let listeningPort: number | undefined;
  let listenerError: string | undefined;

  /** Enlace de emparejamiento del código actual. */
  const linkFor = (code: string): string => {
    const port = listeningPort ?? DEFAULT_PORT;
    return buildPairingUrl(origin?.origin ?? `http://127.0.0.1:${port}`, code);
  };

  /**
   * QR del enlace, ya pintado. Devuelve `undefined` si algo falla: el comando
   * tiene que salir igual, con el enlace, aunque no se pueda pintar el código.
   */
  const qrFor = (code: string): string | undefined => {
    try {
      return qrText(linkFor(code));
    } catch {
      return undefined;
    }
  };

  /** Abre `/pair` en el navegador y cuenta lo que pasó, sin lanzar. */
  const openPairingPage = (): string => {
    const page = `${origin?.origin ?? `http://127.0.0.1:${listeningPort ?? DEFAULT_PORT}`}/pair`;

    void openInBrowser(page).then((abierto) => {
      if (!abierto) log(`could not open the browser at ${page}`);
    });

    return `Opening ${page} in the desktop browser.`;
  };

  /** Resuelve el origen público. No lanza: un fallo deja el nivel anterior. */
  const detectOrigin = async (port: number): Promise<void> => {
    try {
      origin = await resolvePublicOrigin(publicUrl, port);
      log(`public pairing origin: ${origin.origin} (${origin.source})`);
    } catch {
      // Sin detección, el comando ya cae a loopback y lo avisa.
    }
  };

  // --- /mobile: pairing. `open` is the default; `qr` and `link` are opt-ins ------
  if (ctx.commands) {
    const register = (): (() => void) =>
      ctx.commands!.register({
        name: 'mobile',
        description: COMMAND_DESCRIPTION,
        input: { hint: '[open|qr|link|status]' },
        handler: (invocation) => {
          const argument = (invocation.rawInput ?? '').trim().toLowerCase();

          // `status` keeps the diagnostic probe out of the main path.

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

            // `qr` is opt-in on purpose: a text QR only scans when line height
            // equals font size, which the DSH chat does not do. Printing it by
            // default would look right and not scan.
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

            // Opening the pairing page is the default: the QR there is an image,
            // so it scans whatever the chat font is.
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

    // /mobile-say <sessionId> <texto> — E0.3. Acción explícita, nunca automática.
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
          log(`E0.3: inyectando ${text.length} caracteres en ${resolution.id}`);

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

  // --- Estado del producto: emparejamiento y dispositivos ---------------------
  const pairing = new PairingService();
  const devices = new DeviceRegistry({
    persistence: new DevicesFile(join(COMPANION_DIR, 'devices.json')),
  });

  // --- Listener propio (E0.4) --------------------------------------------------
  const portFromEnv = Number(process.env.DSH_MOBILE_PORT ?? '');
  const options = Number.isInteger(portFromEnv) && portFromEnv > 0 ? { port: portFromEnv } : {};
  const publicUrl = process.env.DSH_MOBILE_PUBLIC_URL?.trim();
  const webRoot = findWebRoot();
  log(webRoot ? `PWA served from ${webRoot}` : 'PWA not found; the host serves the API only');

  // Se anuncia solo lo que este host sabe hacer, y se **evalúa en cada hello**: el
  // controlador de workspaces puede montarse después del arranque, y una bandera
  // congelada mentiría en las dos direcciones.
  const limits = (): Capability[] => (hasWorkspaces(ctx) ? ['workspace.list'] : []);

  void startCompanionServer({
    pairing,
    devices,
    capabilities: limits,
    ...options,
    ...(publicUrl ? { publicUrl } : {}),
    ...(webRoot ? { webRoot } : {}),
    // Sesiones: la misma fuente que usa la lista del escritorio.
    listSessions: () => listSessions(ctx),
    // Carpetas: la proyección de workspaces del escritorio, o vacío si no existe.
    listWorkspaces: () => listWorkspaces(ctx),
    // Preguntas: proyección `userQuestions` y respuesta por lote.
    listQuestions: () => listPendingQuestions(ctx),
    answerQuestion: (input) => answerQuestion(ctx, input),
    // Transcripción: historial paginado, eventos en vivo y cancelación.
    readHistory: (sessionId, options) => readHistory(ctx, sessionId, options),
    subscribeSession: (sessionId, options) => subscribeSession(ctx, sessionId, options),
    cancelRun: (sessionId) => cancelRun(ctx, sessionId),
    // Compositor: escribir en la sesión por el mismo camino que el escritorio.
    sendReply: async (sessionId, text) => {
      const result = await injectText(ctx, sessionId, text);
      return result.ok
        ? { ok: true }
        : { ok: false, code: 'bad-request' as const, message: result.detail };
    },
    // Siempre en vivo: un informe cacheado miente en cuanto cambian las sesiones.
    report: () => probe(),
  })
    .then((running) => {
      disposers.push(() => {
        void running.close().catch(() => undefined);
      });

      listeningPort = running.port;
      log(`listener ready on port ${running.port} (try: GET /health)`);

      // Se resuelve después de escuchar: así hay puerto para el último nivel.
      void detectOrigin(running.port);
    })
    .catch((error: unknown) => {
      // Sin listener no hay a dónde emparejar, y el comando tiene que decirlo en
      // vez de enseñar un enlace muerto.
      listenerError = String(error);
      log(`could not open the listener: ${listenerError}`);
    });

  // --- Sondeo de arranque ------------------------------------------------------
  // Se difiere para que el host termine de montar sesiones y proyecciones.
  const timer = setTimeout(() => {
    try {
      probe();
    } catch (error) {
      log(`the startup probe failed: ${String(error)}`);
    }
  }, 2000);
  if (typeof timer.unref === 'function') timer.unref();

  // Cierre ordenado si el host descarga el plugin.
  ctx.effect?.(function* () {
    yield () => {
      clearTimeout(timer);
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch {
          // Un disposer defectuoso no debe impedir los demás.
        }
      }
      log('plugin unloaded');
    };
  }, 'dsh-mobile lifecycle');
}
