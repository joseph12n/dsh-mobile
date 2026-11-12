/**
 * Resolución de identificadores de sesión para el comando humano.
 *
 * Las sesiones se identifican con `session-<uuid>`. Al teclear a mano es fácil
 * dejar el prefijo fuera, pegar los corchetes de una lista o escribir sólo el
 * uuid. Este resolutor acepta todo eso y, si queda ambiguo, dice exactamente
 * entre qué está eligiendo en lugar de fallar con "not found".
 */
import { service, type HostContext, type SessionsService } from '../host-api.js';

export type SessionResolution = { ok: true; id: string } | { ok: false; error: string };

/** Quita los adornos con los que suele pegarse un id. */
function clean(raw: string): string {
  return raw
    .replace(/[<>"'`]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export function resolveSessionId(ctx: HostContext, raw: string): SessionResolution {
  const wanted = clean(raw);
  if (!wanted) return { ok: false, error: 'Missing the session identifier.' };

  const sessions = service<SessionsService>(ctx, 'sessions');
  if (!sessions) return { ok: false, error: 'The sessions service is not available.' };

  let ids: string[];
  try {
    ids = sessions.list().map((session) => session.id);
  } catch (error) {
    return { ok: false, error: `No pude listar las sesiones: ${String(error)}` };
  }

  // 0. Un número elige por posición, con la misma numeración que muestra /mobile.
  if (/^\d+$/.test(wanted)) {
    const index = Number(wanted) - 1;
    const chosen = ids[index];
    if (chosen) return { ok: true, id: chosen };
    return {
      ok: false,
      error: `No session number ${wanted}. There are ${ids.length}:\n${ids.map((id, i) => `${i + 1}) ${id}`).join('\n')}`,
    };
  }

  // 1. Coincidencia exacta, tal cual llegó.
  if (ids.includes(wanted)) return { ok: true, id: wanted };

  // 2. Con el prefijo que se suele omitir.
  const prefixed = wanted.startsWith('session-') ? wanted : `session-${wanted}`;
  if (ids.includes(prefixed)) return { ok: true, id: prefixed };

  // 3. Prefijo único.
  const matches = ids.filter((id) => id.includes(wanted));
  if (matches.length === 1) return { ok: true, id: matches[0]! };
  if (matches.length > 1) {
    return {
      ok: false,
      error: `"${wanted}" es ambiguo y coincide con ${matches.length} sesiones:\n${matches.join('\n')}`,
    };
  }

  return {
    ok: false,
    error: `No session matches "${wanted}".\nLive sessions:\n${ids.join('\n') || '(none)'}`,
  };
}
