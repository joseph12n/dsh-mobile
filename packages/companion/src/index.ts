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

const COMMAND_DESCRIPTION = 'Empareja el teléfono o consulta el estado del compañero móvil';

export function apply(ctx: HostContext): void {
  log(`plugin cargado · evidencia en ${PROBE_LOG_PATH}`);

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

  /** Resuelve el origen público. No lanza: un fallo deja el nivel anterior. */
  const detectOrigin = async (port: number): Promise<void> => {
    try {
      origin = await resolvePublicOrigin(publicUrl, port);
      log(`origen público para el emparejamiento: ${origin.origin} (${origin.source})`);
    } catch {
      // Sin detección, el comando ya cae a loopback y lo avisa.
    }
  };

  // --- Comando /mobile: emparejamiento; /mobile estado: sondeo ------------------
  if (ctx.commands) {
    const register = (): (() => void) =>
      ctx.commands!.register({
        name: 'mobile',
        description: COMMAND_DESCRIPTION,
        input: { hint: '[estado]' },
        handler: (invocation) => {
          const argument = (invocation.rawInput ?? '').trim().toLowerCase();

          // `estado` mantiene el sondeo de desarrollo, que ya no estorba en la
          // ruta principal.
          if (argument === 'estado' || argument === 'probe') {
            try {
              const report = probe();
              return {
                kind: 'success',
                text: `${reportToText(report)}\n\nEvidencia completa: ${PROBE_LOG_PATH}`,
              };
            } catch (error) {
              return { kind: 'error', text: `El sondeo falló: ${String(error)}` };
            }
          }

          try {
            const current = pairing.pending()[0] ?? pairing.issue();
            const message = buildPairingMessage({
              code: current.code,
              expiresAt: current.expiresAt,
              origin,
              port: listeningPort,
              listenerError,
              fallbackPort: DEFAULT_PORT,
            });

            // Sin listener no hay éxito posible: que se vea como fallo.
            return {
              kind: message.compromised && listenerError ? 'error' : 'success',
              text: message.text,
            };
          } catch (error) {
            return { kind: 'error', text: `No pude preparar el emparejamiento: ${String(error)}` };
          }
        },
      });

    // /mobile-say <sessionId> <texto> — E0.3. Acción explícita, nunca automática.
    const registerSay = (): (() => void) =>
      ctx.commands!.register({
        name: 'mobile-say',
        description: 'Inyecta un mensaje en una sesión vía sessionController.prompt (Fase 0, E0.3)',
        input: { hint: '<sessionId> <texto>' },
        handler: (invocation) => {
          const raw = (invocation.rawInput ?? '').trim();
          const split = raw.indexOf(' ');
          if (split <= 0) {
            return { kind: 'error', text: 'Uso: /mobile-say <sessionId> <texto>' };
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
            text: `Envío despachado a ${resolution.id}. El resultado queda en ${PROBE_LOG_PATH}.`,
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
      log(`no pude registrar los comandos: ${String(error)}`);
    }
  } else {
    log('el servicio de comandos no está disponible; /mobile queda fuera');
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
  log(webRoot ? `PWA servida desde ${webRoot}` : 'PWA no encontrada; el host sirve solo la API');

  // Se anuncia solo lo que este host sabe hacer. `workspace.list` viaja únicamente
  // si hay controlador de workspaces: un cliente puede distinguir "no hay carpetas"
  // de "no lo soporta" sin adivinar por el error.
  const limits: Capability[] = hasWorkspaces(ctx) ? ['workspace.list'] : [];

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
      log(`listener listo en el puerto ${running.port} (prueba: GET /health)`);

      // Se resuelve después de escuchar: así hay puerto para el último nivel.
      void detectOrigin(running.port);
    })
    .catch((error: unknown) => {
      // Sin listener no hay a dónde emparejar, y el comando tiene que decirlo en
      // vez de enseñar un enlace muerto.
      listenerError = String(error);
      log(`no pude abrir el listener: ${listenerError}`);
    });

  // --- Sondeo de arranque ------------------------------------------------------
  // Se difiere para que el host termine de montar sesiones y proyecciones.
  const timer = setTimeout(() => {
    try {
      probe();
    } catch (error) {
      log(`el sondeo de arranque falló: ${String(error)}`);
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
      log('plugin descargado');
    };
  }, 'dsh-mobile lifecycle');
}
