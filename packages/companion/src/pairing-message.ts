/**
 * Texto del comando `/mobile`.
 *
 * Vive aparte del registro del comando para poder probarlo: un mensaje que
 * promete un enlace que no funciona cuesta más que no tener comando.
 */
import { buildPairingUrl } from '@dsh-mobile/protocol';
import type { ResolvedOrigin } from './public-origin.js';

const ORIGIN_LABEL: Record<string, string> = {
  config: 'la dirección configurada',
  tailscale: 'el nombre del tailnet',
  loopback: 'solo esta máquina',
  detectando: 'averiguándolo',
};

export interface PairingView {
  code: string;
  expiresAt: number;
  /** Origen público ya resuelto, si la detección terminó. */
  origin?: ResolvedOrigin | undefined;
  /** Puerto real del listener, si llegó a escuchar. */
  port?: number | undefined;
  /** Motivo si el listener no pudo abrirse. */
  listenerError?: string | undefined;
  /** Puerto por defecto, para el caso en que aún no se sabe nada. */
  fallbackPort: number;
}

export interface PairingLink {
  text: string;
  /** `true` si el enlace no servirá desde el teléfono. */
  compromised: boolean;
}

/**
 * Construye el mensaje.
 *
 * Nunca presenta como bueno un enlace con loopback: o hay origen real, o lo dice.
 */
export function buildPairingMessage(view: PairingView): PairingLink {
  if (view.listenerError) {
    return {
      compromised: true,
      text: [
        'El plugin no pudo abrir el listener, así que no hay a dónde emparejar.',
        '',
        view.listenerError,
        '',
        'Revisa que el puerto no esté ocupado y vuelve a iniciar DSH.',
      ].join('\n'),
    };
  }

  // Sin origen resuelto todavía se usa el puerto real, no el de reserva: dar el
  // puerto equivocado manda a la nada aunque el origen acabe siendo bueno.
  const port = view.port ?? view.fallbackPort;
  const base = view.origin?.origin ?? `http://127.0.0.1:${port}`;
  const link = buildPairingUrl(base, view.code);
  const compromised = view.origin === undefined || view.origin.loopback;

  const lines = [
    'Emparejar el teléfono',
    '',
    link,
    '',
    `Código: ${view.code}`,
    `Caduca a las ${new Date(view.expiresAt).toLocaleTimeString()} · un solo uso`,
  ];

  if (compromised) {
    lines.push(
      '',
      'Aviso: este enlace apunta a loopback, que en el teléfono es el propio teléfono.',
      'Ábrelo desde el nombre del tailnet o configura DSH_MOBILE_PUBLIC_URL.',
    );
  }

  const source = view.origin?.source ?? 'detectando';
  lines.push('', `Origen: ${ORIGIN_LABEL[source] ?? source}`);
  return { text: lines.join('\n'), compromised };
}
