import { afterEach, describe, expect, it } from 'vitest';
import { endpointFromLocation, normalizeEndpoint } from './connection.js';

const original = globalThis.location;

afterEach(() => {
  globalThis.location = original;
});

function stubLocation(protocol: string, host: string): void {
  Object.defineProperty(globalThis, 'location', {
    value: { protocol, host },
    configurable: true,
    writable: true,
  });
}

describe('endpoint por defecto', () => {
  it('usa wss sobre https', () => {
    stubLocation('https:', 'maquina.tailnet.ts.net');
    expect(endpointFromLocation()).toBe('wss://maquina.tailnet.ts.net/ws');
  });

  it('usa ws sobre http', () => {
    stubLocation('http:', '127.0.0.1:6768');
    expect(endpointFromLocation()).toBe('ws://127.0.0.1:6768/ws');
  });
});

describe('normalización de lo que teclea el usuario', () => {
  it('respeta un WebSocket ya escrito', () => {
    expect(normalizeEndpoint('wss://host/ws')).toBe('wss://host/ws');
    expect(normalizeEndpoint('ws://host:1234/ws')).toBe('ws://host:1234/ws');
  });

  it('convierte http en ws', () => {
    expect(normalizeEndpoint('https://host')).toBe('wss://host');
    expect(normalizeEndpoint('http://host:6768')).toBe('ws://host:6768');
  });

  it('añade ws a un host pelado', () => {
    expect(normalizeEndpoint('host:6768')).toBe('ws://host:6768');
  });

  it('recorta espacios', () => {
    expect(normalizeEndpoint('  host  ')).toBe('ws://host');
  });

  it('cae al endpoint por defecto si viene vacío', () => {
    stubLocation('https:', 'host');
    expect(normalizeEndpoint('   ')).toBe('wss://host/ws');
  });
});
