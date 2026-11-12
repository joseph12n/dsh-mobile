import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { resolveSessionId } from './sessions.js';

const A = 'session-aaaaaaaa-1111-2222-3333-444444444444';
const B = 'session-bbbbbbbb-1111-2222-3333-444444444444';

function ctxWith(ids: string[]): HostContext {
  return { sessions: { list: () => ids.map((id) => ({ id })), get: () => undefined } };
}

describe('resolución de identificadores de sesión', () => {
  it('acepta el id completo', () => {
    expect(resolveSessionId(ctxWith([A, B]), A)).toEqual({ ok: true, id: A });
  });

  it('acepta el uuid sin el prefijo session-', () => {
    expect(resolveSessionId(ctxWith([A, B]), 'aaaaaaaa-1111-2222-3333-444444444444')).toEqual({
      ok: true,
      id: A,
    });
  });

  it('limpia los corchetes de una lista pegada', () => {
    expect(resolveSessionId(ctxWith([A, B]), `<${A}>`)).toEqual({ ok: true, id: A });
  });

  it('elige por número, como la lista de /mobile', () => {
    expect(resolveSessionId(ctxWith([A, B]), '1')).toEqual({ ok: true, id: A });
    expect(resolveSessionId(ctxWith([A, B]), '2')).toEqual({ ok: true, id: B });
  });

  it('rechaza un número fuera de rango nombrando las que hay', () => {
    const result = resolveSessionId(ctxWith([A]), '9');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('1) ' + A);
  });

  it('acepta un prefijo único', () => {
    expect(resolveSessionId(ctxWith([A, B]), 'bbbb')).toEqual({ ok: true, id: B });
  });

  it('rechaza un prefijo ambiguo', () => {
    const result = resolveSessionId(ctxWith([A, B]), 'session-');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ambiguo');
  });

  it('dice que no existe sin lanzar', () => {
    const result = resolveSessionId(ctxWith([A]), 'zzzz');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('No session matches');
  });

  it('se queja si falta el identificador', () => {
    const result = resolveSessionId(ctxWith([A]), '   ');
    expect(result.ok).toBe(false);
  });
});
