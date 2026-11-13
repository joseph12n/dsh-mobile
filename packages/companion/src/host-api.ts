export interface HostSession {
  readonly id: string;
  deriveMessages?(): readonly unknown[];
}

export interface SessionsService {
  list(): readonly HostSession[];
  get(id: string): HostSession | undefined;
}

export interface ProjectionSnapshot {
  asOfSeq: number;
  values: Record<string, unknown>;
}

export interface ProjectionsService {
  snapshot(session: HostSession, keys?: unknown): ProjectionSnapshot;
}

export interface CommandInvocation {
  rawInput?: string;
  agent?: { ctx?: unknown };
}

export interface CommandDefinition {
  name: string;
  description: string;
  input?: { hint?: string };
  handler: (invocation: CommandInvocation) => { kind: string; text: string };
}

export interface CommandDescriptor {
  name: string;
  description: string;
  input?: { hint?: string };
}

export interface CommandResult {
  kind: 'success' | 'error';
  text?: string;
}

export interface CommandExecution {
  commandId: string;
  result: CommandResult;
}

export interface CommandsService {
  register(definition: CommandDefinition): () => void;
  list(agent: unknown): readonly CommandDescriptor[];
  execute(
    agent: unknown,
    line: string,
    attachments: unknown,
    signal: AbortSignal,
  ): Promise<CommandExecution | undefined>;
}

export interface AgentRegistry {
  get(sessionId: string): unknown;
}

export interface SubagentEntry {
  id: string;
  kind: 'child' | 'diagnostic';
  label?: string;
  mode?: string;
  activity?: 'running' | 'inactive';
  depth?: number;
  hasChildren?: boolean;
  reason?: string;
}

export interface SubagentsService {
  listDescendants(rootSessionId: string, signal?: AbortSignal): Promise<readonly SubagentEntry[]>;
}

export interface SessionPromptRequest {
  requestId: string;
  sessionId: string;
  mode: 'queue' | 'steer';
  content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
}

export interface SessionController {
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<{ accepted: boolean }>;
}

export interface HostContext {
  sessions?: SessionsService;
  sessionProjections?: ProjectionsService;
  commands?: CommandsService;
  subagents?: SubagentsService;
  effect?(factory: () => Generator<unknown, void, unknown>, label?: string): void;
  get?(name: string): unknown;
  reflect?: { store?: Record<string, unknown> };
  [key: string]: unknown;
}

export function service<T>(ctx: HostContext, key: string): T | undefined {
  try {
    const direct = ctx[key];
    if (direct !== undefined) return direct as T;
  } catch {}

  try {
    if (typeof ctx.get === 'function') {
      const resolved = ctx.get(key);
      if (resolved !== undefined) return resolved as T;
    }
  } catch {}

  return undefined;
}

export function serviceNames(ctx: HostContext): string[] {
  const reflect =
    (ctx.reflect as { store?: Record<symbol, { name?: string }> } | undefined) ??
    service<{ store?: Record<symbol, { name?: string }> }>(ctx, 'reflect');

  try {
    const store = reflect?.store;
    if (!store) return [];

    return Object.getOwnPropertySymbols(store)
      .map((symbol) => store[symbol]?.name)
      .filter((name): name is string => typeof name === 'string')
      .sort();
  } catch {
    return [];
  }
}

export function methodNames(value: unknown, limit = 24): string[] {
  if (value === null || typeof value !== 'object') return [];
  try {
    const names = new Set<string>();

    let proto = Object.getPrototypeOf(value) as object | null;
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        names.add(name);
      }
      proto = Object.getPrototypeOf(proto) as object | null;
    }

    return [...names].slice(0, limit);
  } catch {
    return [];
  }
}
