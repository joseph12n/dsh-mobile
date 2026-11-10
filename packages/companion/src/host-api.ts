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
 * Host Session business API (`ctx.sessionController`, dsh-api-session-controller).
 *
 * `prompt()` es la vía legítima para meter texto en una sesión: entra en la
 * bandeja del agente y dispara el turno normal, exactamente como si se hubiera
 * escrito desde la UI de escritorio. `mode: 'steer'` interrumpe el turno en
 * curso; `'queue'` espera turno.
 */
export interface SessionPromptRequest {
  /** Identidad acuñada por el cliente y persistida en el mensaje aceptado. */
  requestId: string;
  sessionId: string;
  mode: 'queue' | 'steer';
  content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
}

export interface SessionController {
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<{ accepted: boolean }>;
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
  /** Resolución de servicios del proxy de cordis; es la vía fiable fuera de `inject`. */
  get?(name: string): unknown;
  /** Capa de reflexión: su `store` es el registro de servicios montados. */
  reflect?: { store?: Record<string, unknown> };
  [key: string]: unknown;
}

/**
 * Lee un servicio del contexto.
 *
 * Acceder a `ctx.foo` sólo funciona para lo que el plugin declara en `inject`;
 * para el resto hay que ir por el proxy de reflexión (`ctx.get`). Esto prueba las
 * dos vías y cae al registro si hace falta.
 */
export function service<T>(ctx: HostContext, key: string): T | undefined {
  try {
    const direct = ctx[key];
    if (direct !== undefined) return direct as T;
  } catch {
    // El proxy puede lanzar si el servicio no está disponible.
  }

  try {
    if (typeof ctx.get === 'function') {
      const resolved = ctx.get(key);
      if (resolved !== undefined) return resolved as T;
    }
  } catch {
    // Igual que arriba.
  }

  return undefined;
}

/**
 * Nombres de todos los servicios montados.
 *
 * El registro de cordis (`ctx.reflect.store`) se indexa por **símbolos**, no por
 * cadenas: `Object.keys()` siempre devuelve vacío. Cada entrada es un `Impl` con
 * su `name`, que es el identificador del servicio.
 */
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

/** Métodos y accesores que expone el prototipo de un servicio. */
export function methodNames(value: unknown, limit = 24): string[] {
  if (value === null || typeof value !== 'object') return [];
  try {
    const names = new Set<string>();

    // Recorre la cadena de prototipos hasta Object, para no perder métodos heredados.
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
