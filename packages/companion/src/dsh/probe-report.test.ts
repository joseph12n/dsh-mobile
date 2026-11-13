import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { reportToText, runProbe } from '../probe.js';

function hostWithEverything(): HostContext {
  const services: Record<string, unknown> = {
    sessions: {
      list: () => [{ id: 's1', deriveMessages: () => [] }],
      get: () => undefined,
    },
    sessionProjections: {
      snapshot: () => ({ asOfSeq: 3, values: { title: 'x', userQuestions: [{ callId: 'c1' }] } }),
    },
    sessionController: { prompt: () => Promise.resolve({ accepted: true }) },
    userQuestions: { list: () => [{ callId: 'c1' }] },
  };

  return {
    sessions: services['sessions'],
    sessionProjections: services['sessionProjections'],
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

  it('describes a list of questions in English', () => {
    expect(texto).toContain('array(1) first element: object{');
    expect(texto).not.toContain('objeto{');
    expect(texto).not.toContain('primer elemento');
  });

  it('describes a service in English', () => {
    expect(texto).toMatch(/object\{prompt\}|absent/);
    expect(texto).not.toContain('objeto{');
  });

  it('describes sessions in English', () => {
    expect(texto).toMatch(/messages=|projections=/);
    expect(texto).not.toContain('proyecciones');
  });

  it('renders every line without a Spanish word', () => {
    for (const palabra of ['Sondeo', 'vivas', 'Servicios', 'ausente', 'mensajes', 'proyecciones']) {
      expect(texto, `«${palabra}» sigue apareciendo`).not.toContain(palabra);
    }
  });
});
