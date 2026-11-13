import { service, type HostContext, type SessionsService } from '../host-api.js';

export type SessionResolution = { ok: true; id: string } | { ok: false; error: string };

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
    return { ok: false, error: `Could not list the sessions: ${String(error)}` };
  }

  if (/^\d+$/.test(wanted)) {
    const index = Number(wanted) - 1;
    const chosen = ids[index];
    if (chosen) return { ok: true, id: chosen };
    return {
      ok: false,
      error: `No session number ${wanted}. There are ${ids.length}:\n${ids.map((id, i) => `${i + 1}) ${id}`).join('\n')}`,
    };
  }

  if (ids.includes(wanted)) return { ok: true, id: wanted };

  const prefixed = wanted.startsWith('session-') ? wanted : `session-${wanted}`;
  if (ids.includes(prefixed)) return { ok: true, id: prefixed };

  const matches = ids.filter((id) => id.includes(wanted));
  if (matches.length === 1) return { ok: true, id: matches[0]! };
  if (matches.length > 1) {
    return {
      ok: false,
      error: `"${wanted}" is ambiguous and matches ${matches.length} sessions:\n${matches.join('\n')}`,
    };
  }

  return {
    ok: false,
    error: `No session matches "${wanted}".\nLive sessions:\n${ids.join('\n') || '(none)'}`,
  };
}
