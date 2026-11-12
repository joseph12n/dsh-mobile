import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@dsh-mobile/protocol';
import { STALE_AFTER_MS, elapsed, groupSessions } from './sessions.js';

/**
 * La lista tiene que responder a una pregunta: **¿qué necesita mi atención?**
 * Por eso una sesión que espera respuesta va arriba aunque esté trabajando.
 */

const NOW = 1_800_000_000_000;

function session(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: `Sesión ${overrides.id}`,
    state: 'idle',
    updatedAt: NOW - 60_000,
    seq: 1,
    pendingQuestions: 0,
    ...overrides,
  };
}

describe('agrupación de sesiones', () => {
  it('pone primero lo que espera respuesta', () => {
    const sections = groupSessions(
      [
        session({ id: 'a', state: 'working' }),
        session({ id: 'b', pendingQuestions: 1 }),
        session({ id: 'c' }),
      ],
      NOW,
    );

    expect(sections.map((section) => section.kind)).toEqual(['waiting', 'working', 'idle']);
    expect(sections[0]?.sessions[0]?.id).toBe('b');
  });

  it('una sesión que espera y además trabaja cuenta como espera', () => {
    // Lo pendiente es lo que bloquea al agente: no se puede esconder en "trabajando".
    const sections = groupSessions(
      [session({ id: 'a', state: 'working', pendingQuestions: 2 })],
      NOW,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe('waiting');
  });

  it('separa las antiguas a partir de siete días', () => {
    const vieja = session({ id: 'vieja', updatedAt: NOW - STALE_AFTER_MS - 1 });
    const reciente = session({ id: 'nueva', updatedAt: NOW - STALE_AFTER_MS + 1 });

    const sections = groupSessions([vieja, reciente], NOW);
    expect(sections.map((section) => section.kind)).toEqual(['idle', 'stale']);
    expect(sections[1]?.sessions[0]?.id).toBe('vieja');
  });

  it('no esconde una sesión con fecha desconocida', () => {
    // updatedAt en 0 es "no sé cuándo"; mandarla a antiguas sería inventarse la edad.
    const sections = groupSessions([session({ id: 'sin-fecha', updatedAt: 0 })], NOW);
    expect(sections[0]?.kind).toBe('idle');
  });

  it('ordena por actividad dentro de cada sección', () => {
    const sections = groupSessions(
      [
        session({ id: 'vieja', updatedAt: NOW - 3_600_000 }),
        session({ id: 'nueva', updatedAt: NOW - 1000 }),
      ],
      NOW,
    );
    expect(sections[0]?.sessions.map((item) => item.id)).toEqual(['nueva', 'vieja']);
  });

  it('omite las secciones vacías', () => {
    const sections = groupSessions([session({ id: 'solo' })], NOW);
    expect(sections).toHaveLength(1);
  });

  it('con la lista vacía no devuelve secciones', () => {
    expect(groupSessions([], NOW)).toEqual([]);
  });
});

describe('elapsed', () => {
  it('says now inside the first minute', () => {
    expect(elapsed(NOW - 30_000, NOW)).toEqual({ unit: 'now' });
  });

  it('counts minutes, hours and days', () => {
    expect(elapsed(NOW - 5 * 60_000, NOW)).toEqual({ unit: 'minutes', count: 5 });
    expect(elapsed(NOW - 3 * 3_600_000, NOW)).toEqual({ unit: 'hours', count: 3 });
    expect(elapsed(NOW - 2 * 86_400_000, NOW)).toEqual({ unit: 'days', count: 2 });
  });

  it('returns nothing for an unknown date', () => {
    expect(elapsed(0, NOW)).toBeUndefined();
  });

  it('never reports a negative age when the clock is ahead', () => {
    expect(elapsed(NOW + 60_000, NOW)).toEqual({ unit: 'now' });
  });

  it('truncates: 6.5 days is 6, not 7', () => {
    // Rounding up made the text contradict the group the session was in.
    expect(elapsed(NOW - 6.5 * 86_400_000, NOW)).toEqual({ unit: 'days', count: 6 });
  });

  it('one millisecond before the cutoff still says 6 days', () => {
    expect(elapsed(NOW - (STALE_AFTER_MS - 1), NOW)).toEqual({ unit: 'days', count: 6 });
  });

  it('at the cutoff it says 7', () => {
    expect(elapsed(NOW - STALE_AFTER_MS, NOW)).toEqual({ unit: 'days', count: 7 });
  });
});
