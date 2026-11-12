import { describe, expect, it } from 'vitest';
import { buildPairingMessage } from './pairing-message.js';
import type { ResolvedOrigin } from './public-origin.js';

/**
 * El mensaje del comando es lo que sustituye a abrir una URL a mano. Si promete
 * un enlace que no funciona, el usuario pierde el tiempo en el teléfono.
 */

const TAILNET: ResolvedOrigin = {
  origin: 'https://maquina.tailnet.ts.net',
  source: 'tailscale',
  loopback: false,
};

const LOOPBACK: ResolvedOrigin = {
  origin: 'http://127.0.0.1:6768',
  source: 'loopback',
  loopback: true,
};

const base = {
  code: 'ABCD1234EFGH5678',
  expiresAt: 1_800_000_000_000,
  fallbackPort: 6768,
};

describe('mensaje de emparejamiento', () => {
  it('muestra el enlace, el código y la caducidad', () => {
    const { text, compromised } = buildPairingMessage({ ...base, origin: TAILNET, port: 6768 });

    expect(compromised).toBe(false);
    expect(text).toContain('https://maquina.tailnet.ts.net/#/pair?v=1&c=ABCD1234EFGH5678');
    expect(text).toContain('ABCD1234EFGH5678');
    expect(text).toContain('single use');
  });

  it('no avisa cuando el origen es bueno', () => {
    const { text } = buildPairingMessage({ ...base, origin: TAILNET, port: 6768 });
    expect(text).not.toContain('Heads up');
  });

  it('avisa cuando el origen es loopback', () => {
    const { text, compromised } = buildPairingMessage({ ...base, origin: LOOPBACK, port: 6768 });

    expect(compromised).toBe(true);
    expect(text).toContain('Heads up');
    expect(text).toContain('loopback');
  });

  it('avisa mientras el origen aún no se ha resuelto', () => {
    // Sin origen no se puede prometer nada: se cae a loopback y se dice.
    const { text, compromised } = buildPairingMessage({ ...base, port: 6768 });
    expect(compromised).toBe(true);
    expect(text).toContain('http://127.0.0.1:6768');
    expect(text).toContain('averiguándolo');
  });

  it('usa el puerto real, no el de reserva, cuando el listener ya escucha', () => {
    const { text } = buildPairingMessage({ ...base, port: 55214 });
    expect(text).toContain('http://127.0.0.1:55214');
    expect(text).not.toContain('6768');
  });

  it('cae al puerto de reserva si ni siquiera se sabe el real', () => {
    const { text } = buildPairingMessage({ ...base });
    expect(text).toContain('http://127.0.0.1:6768');
  });

  it('con listener caído no inventa un enlace: lo explica', () => {
    const { text, compromised } = buildPairingMessage({
      ...base,
      listenerError: 'EADDRINUSE',
    });

    expect(compromised).toBe(true);
    expect(text).toContain('no pudo abrir el listener');
    expect(text).toContain('EADDRINUSE');
    expect(text).not.toContain('#/pair');
  });
});

describe('el QR sustituye al código copiado a mano', () => {
  it('con QR, el mensaje lo pinta y no obliga a copiar nada', () => {
    const { text } = buildPairingMessage({
      ...base,
      origin: TAILNET,
      port: 6768,
      qr: '  █▀▀▀█\n  █   █\n  █▄▄▄█',
    });

    expect(text).toContain('Scan this');
    expect(text).toContain('█▀▀▀█');
  });

  it('sin QR sigue dando el enlace, para no dejarte sin salida', () => {
    // El QR puede fallar (por ejemplo si la librería no puede con el texto). El
    // comando tiene que seguir sirviendo.
    const { text } = buildPairingMessage({ ...base, origin: TAILNET, port: 6768 });
    expect(text).toContain('https://maquina.tailnet.ts.net/#/pair?v=1&c=ABCD1234EFGH5678');
    expect(text).not.toContain('Scan this');
  });

  it('el enlace aparece siempre, con QR o sin él', () => {
    const conQr = buildPairingMessage({ ...base, origin: TAILNET, qr: '███' });
    const sinQr = buildPairingMessage({ ...base, origin: TAILNET });
    expect(conQr.text).toContain('Link: https://maquina.tailnet.ts.net');
    expect(sinQr.text).toContain('Link: https://maquina.tailnet.ts.net');
  });
});
