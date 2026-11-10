import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, buildPairingUrl, parsePairingUrl } from './index.js';

const BASE = 'https://maquina.tailnet.ts.net';
const CODE = 'ABCD1234EFGH5678';

describe('enlace de emparejamiento', () => {
  it('pone el código en el fragmento, nunca en la query', () => {
    const url = buildPairingUrl(BASE, CODE);
    expect(url).toContain('#/pair?');
    expect(url.split('#')[0]).not.toContain(CODE);
  });

  it('incluye versión de protocolo y código', () => {
    const parsed = parsePairingUrl(buildPairingUrl(BASE, CODE));
    expect(parsed).toEqual({ v: PROTOCOL_VERSION, c: CODE });
  });

  it('lleva el endpoint cuando difiere del origen de la PWA', () => {
    const url = buildPairingUrl(BASE, CODE, 'wss://maquina.tailnet.ts.net/ws');
    expect(parsePairingUrl(url)).toEqual({
      v: PROTOCOL_VERSION,
      c: CODE,
      e: 'wss://maquina.tailnet.ts.net/ws',
    });
  });

  it('descarta un fragmento previo del baseUrl', () => {
    const url = buildPairingUrl(`${BASE}/#/algo-viejo`, CODE);
    expect(url.match(/#/g)?.length, 'un solo fragmento').toBe(1);
  });

  it('se niega a leer un enlace que no es de emparejamiento', () => {
    expect(parsePairingUrl('https://ejemplo.com/#/otra-cosa?v=1&c=X')).toBeUndefined();
    expect(parsePairingUrl('https://ejemplo.com/')).toBeUndefined();
    expect(parsePairingUrl('no es una url')).toBeUndefined();
  });

  it('se niega a leer un enlace sin código', () => {
    expect(parsePairingUrl('https://ejemplo.com/#/pair?v=1')).toBeUndefined();
  });
});
