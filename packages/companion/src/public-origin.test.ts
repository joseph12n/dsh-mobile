import { describe, expect, it } from 'vitest';
import { findTailscaleBinary, parseTailnetName, resolvePublicOrigin } from './public-origin.js';

describe('nombre del tailnet', () => {
  it('lee el DNSName y le quita el punto final', () => {
    expect(parseTailnetName('{"Self":{"DNSName":"maquina.tailnet.ts.net."}}')).toBe(
      'maquina.tailnet.ts.net',
    );
  });

  it('devuelve undefined si el JSON no sirve', () => {
    expect(parseTailnetName('no es json')).toBeUndefined();
    expect(parseTailnetName('{}')).toBeUndefined();
    expect(parseTailnetName('{"Self":{}}')).toBeUndefined();
    expect(parseTailnetName('{"Self":{"DNSName":42}}')).toBeUndefined();
  });
});

describe('resolución del origen público', () => {
  it('la configuración explícita manda', async () => {
    const resolved = await resolvePublicOrigin('https://otro.example', 6768, () =>
      Promise.resolve('maquina.tailnet.ts.net'),
    );
    expect(resolved).toEqual({ origin: 'https://otro.example', source: 'config', loopback: false });
  });

  it('quita la barra final de la configuración', async () => {
    const resolved = await resolvePublicOrigin('https://otro.example/', 6768);
    expect(resolved.origin).toBe('https://otro.example');
  });

  it('usa el nombre del tailnet cuando no hay configuración', async () => {
    const resolved = await resolvePublicOrigin(undefined, 6768, () =>
      Promise.resolve('maquina.tailnet.ts.net'),
    );
    expect(resolved).toEqual({
      origin: 'https://maquina.tailnet.ts.net',
      source: 'tailscale',
      loopback: false,
    });
  });

  it('cae al listener y lo marca como loopback', async () => {
    const resolved = await resolvePublicOrigin(undefined, 6768, () => Promise.resolve(undefined));
    expect(resolved).toEqual({
      origin: 'http://127.0.0.1:6768',
      source: 'loopback',
      loopback: true,
    });
  });

  it('sobrevive a que la consulta a Tailscale falle', async () => {
    const resolved = await resolvePublicOrigin(undefined, 6768, () =>
      Promise.reject(new Error('tailscale no está')),
    );
    expect(resolved.source).toBe('loopback');
  });

  it('marca como loopback una configuración que lo sea', async () => {
    const resolved = await resolvePublicOrigin('http://127.0.0.1:6768', 6768);
    expect(resolved.loopback).toBe(true);
  });

  it('marca como loopback localhost', async () => {
    const resolved = await resolvePublicOrigin('http://localhost:6768', 6768);
    expect(resolved.loopback).toBe(true);
  });

  it('descarta una configuración que no es un origen y sigue con la detección', async () => {
    const resolved = await resolvePublicOrigin('localhost:6768', 6768, () =>
      Promise.resolve('maquina.tailnet.ts.net'),
    );
    expect(resolved.source).toBe('tailscale');
    expect(resolved.origin).toBe('https://maquina.tailnet.ts.net');
  });
});

describe('binario de tailscale', () => {
  it('elige el primer candidato que existe', () => {
    expect(findTailscaleBinary(['/no/existe/tailscale', process.execPath])).toBe(process.execPath);
  });

  it('devuelve undefined si no hay ninguno', () => {
    expect(findTailscaleBinary(['/no/existe/tailscale', '/tampoco/existe'])).toBeUndefined();
  });

  it('con la lista real de la plataforma no lanza', () => {
    expect(() => findTailscaleBinary()).not.toThrow();
  });
});
