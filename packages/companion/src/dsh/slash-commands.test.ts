import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { commandsAvailable, listCommands, runCommand } from './slash-commands.js';

interface FakeContext {
  listing?: unknown[];
  execute?: (
    agent: unknown,
    line: string,
  ) => Promise<
    { commandId: string; result: { kind: 'success' | 'error'; text?: string } } | undefined
  >;
  agent?: unknown;
  noCommands?: boolean;
  noAgents?: boolean;
}

function context(options: FakeContext = {}): HostContext {
  const commands = options.noCommands
    ? undefined
    : {
        register: () => () => undefined,
        list: () => options.listing ?? [],
        execute: options.execute ?? (async () => undefined),
      };

  const agents = options.noAgents
    ? undefined
    : { get: () => ('agent' in options ? options.agent : { id: 'agent-1' }) };

  return { commands, agents } as unknown as HostContext;
}

describe('listCommands', () => {
  it('traduce los descriptores y conserva la pista de entrada', () => {
    const ctx = context({
      listing: [
        { name: 'plan', description: 'Entrar en modo plan', input: { hint: '<mensaje>' } },
        { name: 'goal', description: 'Ver el objetivo actual' },
      ],
    });

    expect(listCommands(ctx, 'session-1')).toEqual([
      { name: 'plan', description: 'Entrar en modo plan', hint: '<mensaje>' },
      { name: 'goal', description: 'Ver el objetivo actual' },
    ]);
  });

  it('devuelve una lista vacía sin agente vivo o sin servicio', () => {
    expect(listCommands(context({ agent: undefined }), 'session-1')).toEqual([]);
    expect(listCommands(context({ noAgents: true }), 'session-1')).toEqual([]);
    expect(listCommands(context({ noCommands: true }), 'session-1')).toEqual([]);
  });

  it('no rompe la lista si el registro falla', () => {
    const ctx = context({
      listing: [],
    });
    const commands = (ctx as unknown as { commands: { list: () => unknown[] } }).commands;
    commands.list = () => {
      throw new Error('roto');
    };

    expect(listCommands(ctx, 'session-1')).toEqual([]);
  });
});

describe('runCommand', () => {
  it('ejecuta la línea contra el agente y devuelve el resultado', async () => {
    const calls: Array<{ agent: unknown; line: string }> = [];
    const ctx = context({
      execute: async (agent, line) => {
        calls.push({ agent, line });
        return { commandId: 'command-1', result: { kind: 'success', text: 'hecho' } };
      },
    });

    await expect(
      runCommand(ctx, { sessionId: 'session-1', line: '/plan revisa' }),
    ).resolves.toEqual({ ok: true, result: { kind: 'success', text: 'hecho' } });
    expect(calls).toEqual([{ agent: { id: 'agent-1' }, line: '/plan revisa' }]);
  });

  it('convierte una línea desconocida en un error de comando', async () => {
    await expect(
      runCommand(context({ execute: async () => undefined }), {
        sessionId: 'session-1',
        line: '/nope',
      }),
    ).resolves.toEqual({
      ok: true,
      result: { kind: 'error', text: 'Unknown command or invalid syntax.' },
    });
  });

  it('convierte una excepción del handler en un error de comando', async () => {
    await expect(
      runCommand(
        context({
          execute: async () => {
            throw new Error('se rompió');
          },
        }),
        { sessionId: 'session-1', line: '/plan' },
      ),
    ).resolves.toEqual({ ok: true, result: { kind: 'error', text: 'se rompió' } });
  });

  it('rechaza la ejecución sin servicio o sin agente', async () => {
    await expect(
      runCommand(context({ noCommands: true }), { sessionId: 'session-1', line: '/plan' }),
    ).resolves.toMatchObject({ ok: false, code: 'bad-request' });

    await expect(
      runCommand(context({ agent: undefined }), { sessionId: 'session-1', line: '/plan' }),
    ).resolves.toMatchObject({ ok: false, code: 'not-found' });
  });
});

describe('commandsAvailable', () => {
  it('exige el registro y el registro de agentes', () => {
    expect(commandsAvailable(context())).toBe(true);
    expect(commandsAvailable(context({ noCommands: true }))).toBe(false);
    expect(commandsAvailable(context({ noAgents: true }))).toBe(false);
  });
});
