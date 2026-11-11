import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@dsh-mobile/protocol';
import { STALE_AFTER_MS, groupSessions, relativeTime } from './sessions.js';

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

  it('cada sección lleva un título legible', () => {
    const sections = groupSessions(
      [session({ id: 'a', pendingQuestions: 1 }), session({ id: 'b', state: 'working' })],
      NOW,
    );
    expect(sections.map((section) => section.title)).toEqual([
      'Esperando tu respuesta',
      'Trabajando',
    ]);
  });
});

describe('tiempo relativo', () => {
  it('dice "ahora" en el primer minuto', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('ahora');
  });

  it('cuenta minutos, horas y días', () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('hace 5 min');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('hace 3 h');
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('hace 2 d');
  });

  it('no devuelve texto para una fecha desconocida', () => {
    expect(relativeTime(0, NOW)).toBe('');
  });

  it('no muestra tiempos negativos si el reloj va adelantado', () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe('ahora');
  });
});
