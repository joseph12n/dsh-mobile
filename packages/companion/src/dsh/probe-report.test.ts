import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { reportToText, runProbe } from '../probe.js';

/**
 * The diagnostic report, rendered.
 *
 * This exists because the original translation bug hid here: the report was checked once
 * against an empty host, so the branches that print `object{…}` and `first element` were
 * never executed and stayed in Spanish. A report nobody renders is a report nobody checks.
 */

/** A host with a session and a service that can take text, so the deep branches run. */
function hostWithEverything(): HostContext {
  const services: Record<string, unknown> = {
    sessions: {
      list: () => [{ id: 's1', deriveMessages: () => [] }],
      get: () => undefined,
    },
    sessionProjections: { snapshot: () => ({ asOfSeq: 3, values: { title: 'x' } }) },
    sessionController: { prompt: () => Promise.resolve({ accepted: true }) },
    userQuestions: { list: () => [{ callId: 'c1' }] },
  };

  return {
    sessions: services['sessions'],
    sessionProjections: services['sessionProjections'],
    // El sondeo busca servicios por el proxy de reflexión cuando no están en `inject`.
    get: (name: string) => services[name],
    reflect: { store: {} },
  } as unknown as HostContext;
}

describe('the probe report is English', () => {
  const texto = reportToText(runProbe(hostWithEverything()));

  it('names the phase and the counts in English', () => {
    expect(texto).toContain('Phase 0 probe');
    expect(texto).toContain('Live sessions:');
    expect(texto).toContain('Mounted services:');
  });

  it('describes services in English', () => {
    // `objeto{…}` y `primer elemento` eran las dos cadenas que sobrevivieron.
    expect(texto).not.toContain('objeto{');
    expect(texto).not.toContain('primer elemento');
    expect(texto).toMatch(/object\{|absent/);
  });

  it('describes sessions in English', () => {
    expect(texto).toMatch(/messages=|projections=/);
    expect(texto).not.toContain('proyecciones');
  });

  it('renders every line without a Spanish word', () => {
    // Una lista corta de palabras que solo aparecen en español en este informe.
    for (const palabra of ['Sondeo', 'vivas', 'Servicios', 'ausente', 'mensajes', 'proyecciones']) {
      expect(texto, `«${palabra}» sigue apareciendo`).not.toContain(palabra);
    }
  });
});
