import { buildPairingUrl } from '@dsh-mobile/protocol';
import type { ResolvedOrigin } from './public-origin.js';

const ORIGIN_LABEL: Record<string, string> = {
  config: 'the configured address',
  tailscale: 'the tailnet name',
  loopback: 'this machine only',
  detectando: 'working it out',
};

export interface PairingView {
  code: string;
  expiresAt: number;
  origin?: ResolvedOrigin | undefined;
  port?: number | undefined;
  listenerError?: string | undefined;
  fallbackPort: number;
  qr?: string | undefined;
}

export interface PairingLink {
  text: string;
  compromised: boolean;
}

export function buildPairingMessage(view: PairingView): PairingLink {
  if (view.listenerError) {
    return {
      compromised: true,
      text: [
        'The plugin could not open its listener, so there is nowhere to pair.',
        '',
        view.listenerError,
        '',
        'Check that the port is free and start DSH again.',
      ].join('\n'),
    };
  }

  const port = view.port ?? view.fallbackPort;
  const base = view.origin?.origin ?? `http://127.0.0.1:${port}`;
  const link = buildPairingUrl(base, view.code);
  const compromised = view.origin === undefined || view.origin.loopback;

  const lines = ['Pair your phone', ''];

  if (view.qr) {
    lines.push(
      'Scan this with your phone camera. It only works where line height equals',
      'font size; if it does not scan, open the pairing page instead:',
      '',
      view.qr,
      '',
    );
  }

  lines.push(`Link: ${link}`, `Code: ${view.code}`);
  lines.push(`Expires at ${new Date(view.expiresAt).toLocaleTimeString()} · single use`);

  if (compromised) {
    lines.push(
      '',
      'Heads up: this link points at loopback, which on a phone is the phone itself.',
      'Open it through the tailnet name, or set DSH_MOBILE_PUBLIC_URL.',
    );
  }

  const source = view.origin?.source ?? 'detectando';
  lines.push('', `Origin: ${ORIGIN_LABEL[source] ?? source}`);
  return { text: lines.join('\n'), compromised };
}
