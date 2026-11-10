/**
 * Adaptador de entrada: envía texto a una sesión.
 *
 * Este es el único punto del plugin que sabe cómo se inyecta un mensaje en DSH.
 * Mantenerlo aquí aislado es lo que permite que el resto del sistema (y el
 * móvil) no dependa de la forma interna de `sessionController`.
 */
import { service, type HostContext, type SessionController } from '../host-api.js';

export type InjectMode = 'queue' | 'steer';

export interface InjectResult {
  ok: boolean;
  detail: string;
}

/**
 * Envía `text` a la sesión indicada.
 *
 * No lanza: devuelve un resultado legible para que el comando pueda informar sin
 * tumbar el host. El `requestId` lo acuña el llamador (aquí) para que DSH tenga
 * una identidad estable del mensaje.
 */
export async function injectText(
  ctx: HostContext,
  sessionId: string,
  text: string,
  mode: InjectMode = 'queue',
): Promise<InjectResult> {
  const controller = service<SessionController>(ctx, 'sessionController');

  if (!controller || typeof controller.prompt !== 'function') {
    return { ok: false, detail: 'ctx.sessionController no está disponible en este host.' };
  }

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, detail: 'El texto está vacío.' };

  try {
    const result = await controller.prompt(
      {
        requestId: globalThis.crypto.randomUUID(),
        sessionId,
        mode,
        content: [{ type: 'text', text: trimmed }],
      },
      new AbortController().signal,
    );

    return result.accepted
      ? { ok: true, detail: `Mensaje aceptado en ${sessionId} (modo ${mode}).` }
      : { ok: false, detail: `El host no aceptó el mensaje para ${sessionId}.` };
  } catch (error) {
    return { ok: false, detail: `Falló la inyección: ${String(error)}` };
  }
}
