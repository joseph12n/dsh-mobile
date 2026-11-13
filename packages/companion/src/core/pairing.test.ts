import { describe, expect, it } from 'vitest';
import { CODE_BYTES, DEFAULT_TTL_MS, PairingService, normalizeCode } from './pairing.js';

function makeService(startAt = 1_000_000): {
  service: PairingService;
  advance: (ms: number) => void;
} {
  let now = startAt;
  let counter = 0;
  const service = new PairingService({
    now: () => now,
    generate: () => `TEST${String((counter += 1)).padStart(4, '0')}`,
  });
  return { service, advance: (ms: number) => (now += ms) };
}

describe('codigos de emparejamiento', () => {
  it('emite un código con caducidad de diez minutos', () => {
    const { service } = makeService();
    const issued = service.issue();
    expect(issued.expiresAt - 1_000_000).toBe(DEFAULT_TTL_MS);
    expect(issued.code).toMatch(/^TEST\d{4}$/);
  });

  it('acepta el código una sola vez', () => {
    const { service } = makeService();
    const { code } = service.issue();
    expect(service.redeem(code)).toBe('ok');
    expect(service.redeem(code)).toBe('consumed');
  });

  it('rechaza un código caducado', () => {
    const { service, advance } = makeService();
    const { code } = service.issue();
    advance(DEFAULT_TTL_MS + 1);
    expect(service.redeem(code)).toBe('expired');
  });

  it('acepta justo antes de vencer', () => {
    const { service, advance } = makeService();
    const { code } = service.issue();
    advance(DEFAULT_TTL_MS - 1);
    expect(service.redeem(code)).toBe('ok');
  });

  it('distingue "no existe" de "ya usado"', () => {
    const { service } = makeService();
    const { code } = service.issue();
    service.redeem(code);
    expect(service.redeem('OTROCODIGO')).toBe('unknown');
    expect(service.redeem(code)).toBe('consumed');
  });

  it('normaliza lo que pega un humano', () => {
    expect(normalizeCode('abcd-1234 efgh')).toBe('ABCD1234EFGH');
    expect(normalizeCode('il0')).toBe('110');
  });

  it('lista pendientes sin incluir los ya canjeados', () => {
    const { service } = makeService();
    const first = service.issue();
    service.issue();
    service.redeem(first.code);
    expect(service.pending()).toHaveLength(1);
  });

  it('genera códigos distintos por defecto', () => {
    const service = new PairingService();
    const codes = new Set(Array.from({ length: 50 }, () => service.issue().code));
    expect(codes.size).toBe(50);
  });

  it('usa 128 bits de entropía por defecto', () => {
    const service = new PairingService();
    expect(service.issue().code).toHaveLength(Math.ceil((CODE_BYTES * 8) / 5));
  });
});
