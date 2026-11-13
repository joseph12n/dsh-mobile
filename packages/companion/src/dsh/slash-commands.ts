import type { CommandInfo, CommandResult } from '@dsh-mobile/protocol';
import {
  service,
  type AgentRegistry,
  type CommandsService,
  type HostContext,
} from '../host-api.js';

export function commandsAvailable(ctx: HostContext): boolean {
  return (
    Boolean(service<CommandsService>(ctx, 'commands')) &&
    Boolean(service<AgentRegistry>(ctx, 'agents'))
  );
}

export function listCommands(ctx: HostContext, sessionId: string): CommandInfo[] {
  const commands = service<CommandsService>(ctx, 'commands');
  if (!commands) return [];

  const agent = service<AgentRegistry>(ctx, 'agents')?.get(sessionId);
  if (!agent) return [];

  try {
    return commands.list(agent).map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.input?.hint ? { hint: command.input.hint } : {}),
    }));
  } catch {
    return [];
  }
}

export interface RunCommandOutcome {
  ok: boolean;
  code?: 'not-found' | 'bad-request' | 'internal';
  message?: string;
  result?: CommandResult;
}

export async function runCommand(
  ctx: HostContext,
  input: { sessionId: string; line: string },
): Promise<RunCommandOutcome> {
  const commands = service<CommandsService>(ctx, 'commands');
  if (!commands) {
    return { ok: false, code: 'bad-request', message: 'This host does not expose commands.' };
  }

  const agent = service<AgentRegistry>(ctx, 'agents')?.get(input.sessionId);
  if (!agent) {
    return {
      ok: false,
      code: 'not-found',
      message: 'The session is not loaded on the host. Open it on the desktop and try again.',
    };
  }

  try {
    const execution = await commands.execute(
      agent,
      input.line,
      undefined,
      new AbortController().signal,
    );

    if (!execution) {
      return {
        ok: true,
        result: { kind: 'error', text: 'Unknown command or invalid syntax.' },
      };
    }

    return {
      ok: true,
      result: {
        kind: execution.result.kind,
        ...(execution.result.text !== undefined ? { text: execution.result.text } : {}),
      },
    };
  } catch (error) {
    return {
      ok: true,
      result: { kind: 'error', text: error instanceof Error ? error.message : String(error) },
    };
  }
}
