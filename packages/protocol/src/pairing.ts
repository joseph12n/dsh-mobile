import { z } from 'zod';
import { PROTOCOL_VERSION } from './version.js';

export const PairingParams = z.object({
  v: z.number().int().positive(),
  c: z.string().min(1),
  e: z.string().min(1).optional(),
});
export type PairingParams = z.infer<typeof PairingParams>;

export const PAIRING_HASH_PREFIX = '#/pair';

export function buildPairingUrl(baseUrl: string, code: string, endpoint?: string): string {
  const url = new URL(baseUrl);
  url.hash = '';

  const params = new URLSearchParams();
  params.set('v', String(PROTOCOL_VERSION));
  params.set('c', code);
  if (endpoint) params.set('e', endpoint);

  url.hash = `${PAIRING_HASH_PREFIX}?${params.toString()}`;
  return url.toString();
}

export function parsePairingUrl(raw: string): PairingParams | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }

  const hash = url.hash.replace(/^#/, '');
  const questionMark = hash.indexOf('?');
  if (questionMark < 0) return undefined;
  if (!hash.slice(0, questionMark).startsWith('/pair')) return undefined;

  const params = new URLSearchParams(hash.slice(questionMark + 1));
  const v = Number(params.get('v'));
  const c = params.get('c');
  if (!c) return undefined;

  const candidate = { v: Number.isInteger(v) ? v : PROTOCOL_VERSION, c };
  const endpoint = params.get('e');
  const result = PairingParams.safeParse(endpoint ? { ...candidate, e: endpoint } : candidate);
  return result.success ? result.data : undefined;
}
