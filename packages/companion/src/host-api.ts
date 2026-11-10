/**
 * Vista estructural y mínima de la API de DSH que consume el plugin.
 *
 * A propósito no importa tipos de `@deepseek-ai/*`: el plugin se enlaza en el
 * perfil del usuario, donde esos paquetes no son resolubles. Declarar aquí la
 * forma que usamos mantiene el acoplamiento en un solo archivo y hace que un
 * cambio de DSH falle en un sitio concreto.
 *
 * Los tipos se basan en las declaraciones de DSH 0.2.2-rc.1:
 *  - `SessionsService.list()/get()`           (dsh-session)
 *  - `Session.id`, `Session.deriveMessages()` (dsh-session)
 *  - `SessionProjectionRegistry.snapshot()`   (dsh-session-projection)
 *  - `CommandsService.register()`             (dsh-commands)
 */

export interface HostSession {
  readonly id: string;
  /** Mensajes derivados del log. La forma exacta la define dsh-llm. */
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

export interface CommandsService {
  register(definition: CommandDefinition): () => void;
}

/**
 * El contexto de cordis. `effect` ejecuta un generador cuyos `yield`s son
 * recursos con `dispose`, y los limpia al descargar el plugin.
 */
export interface HostContext {
  sessions?: SessionsService;
  sessionProjections?: ProjectionsService;
  commands?: CommandsService;
  effect?(factory: () => Generator<unknown, void, unknown>, label?: string): void;
  [key: string]: unknown;
}

/** Lee un servicio del contexto sin lanzar si no está montado. */
export function service<T>(ctx: HostContext, key: string): T | undefined {
  try {
    const value = ctx[key];
    return (value as T | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}
