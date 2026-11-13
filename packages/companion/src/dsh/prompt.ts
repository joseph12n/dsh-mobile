import { service, type HostContext, type SessionController } from '../host-api.js';

export type InjectMode = 'queue' | 'steer';

export interface InjectResult {
  ok: boolean;
  detail: string;
}

export async function injectText(
  ctx: HostContext,
  sessionId: string,
  text: string,
  mode: InjectMode = 'queue',
): Promise<InjectResult> {
  const controller = service<SessionController>(ctx, 'sessionController');

  if (!controller || typeof controller.prompt !== 'function') {
    return { ok: false, detail: 'ctx.sessionController is not available on this host.' };
  }

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, detail: 'The text is empty.' };

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
      ? { ok: true, detail: `Message accepted on ${sessionId} (mode ${mode}).` }
      : { ok: false, detail: `The host did not accept the message for ${sessionId}.` };
  } catch (error) {
    return { ok: false, detail: `Injection failed: ${String(error)}` };
  }
}
