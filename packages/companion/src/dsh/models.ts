/**
 * Model selection from the phone.
 *
 * The catalog and the choice come from the **same** controller the desktop UI
 * uses (`session.modelCatalog` and `session.selectModel`), so both surfaces
 * cannot disagree about which models exist or which route a session will take.
 * Nothing here rebuilds the catalog from `ctx.llm` by hand: a copy would drift.
 *
 * Shapes read from `@deepseek-ai/dsh-api-session-controller` 0.2.2-rc.1:
 *
 *  - `modelCatalog()` takes no request and returns
 *    `{ default, routableProviders, groups: [{ id, name, models: [...] }], failures }`.
 *  - each model carries `reasoning?: { efforts: [{ id, name, description? }], defaultEffort? }`.
 *  - `selectModel({ sessionId, provider, model, reasoningEffort? })` returns
 *    `{ selected: { provider, model, reasoningEffort? } }`.
 *  - an unavailable model rejects with `session/model-unavailable`, and an
 *    unknown session with `session/not-found`.
 */
import { service, type HostContext } from '../host-api.js';
import type {
  ModelCatalog,
  ModelFailure,
  ModelGroup,
  ModelOption,
  ModelSelection,
} from '@dsh-mobile/protocol';
import { codeOf, messageOf } from './errors.js';

/** One provider group as the host sends it. Every field is unknown on purpose. */
interface CatalogGroup {
  id?: unknown;
  name?: unknown;
  models?: unknown;
}

/** One model as the host sends it. */
interface CatalogModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  reasoning?: { efforts?: unknown; defaultEffort?: unknown };
}

/** The catalog payload. `default` is always present; the rest can be empty. */
interface CatalogPayload {
  default?: unknown;
  groups?: unknown;
  failures?: unknown;
}

/** The part of the session controller we use for models. */
export interface ModelController {
  modelCatalog?: () => Promise<CatalogPayload>;
  selectModel?: (request: {
    sessionId: string;
    provider: string;
    model: string;
    reasoningEffort?: string;
  }) => Promise<{ selected?: unknown }>;
}

/** Reads a non-empty string, or `undefined`. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** One selection, from a payload keyed like the host's projection. */
export function selectionOf(value: unknown): ModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as Record<string, unknown>;

  const provider = text(source['provider']);
  const model = text(source['model']);
  if (!provider || !model) return undefined;

  const effort = text(source['reasoningEffort']);
  return {
    provider,
    model,
    ...(effort ? { reasoningEffort: effort } : {}),
  };
}

/** Reads a model's effort list, when the adapter advertises one. */
function effortsOf(
  value: unknown,
): Pick<ModelOption, 'reasoningEfforts' | 'defaultReasoningEffort'> {
  if (typeof value !== 'object' || value === null) return {};
  const reasoning = (value as CatalogModel).reasoning;
  if (typeof reasoning !== 'object' || reasoning === null) return {};

  const raw = reasoning.efforts;
  const efforts = Array.isArray(raw)
    ? raw.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const item = entry as { id?: unknown; name?: unknown; description?: unknown };
        const id = text(item.id);
        if (!id) return [];
        return [
          {
            id,
            name: text(item.name) ?? id,
            ...(text(item.description) ? { description: text(item.description) } : {}),
          },
        ];
      })
    : [];

  const defaultEffort = text(reasoning.defaultEffort);
  return {
    ...(efforts.length > 0 ? { reasoningEfforts: efforts } : {}),
    ...(defaultEffort ? { defaultReasoningEffort: defaultEffort } : {}),
  };
}

/** One model, or `undefined` when it cannot be offered: no id, no row. */
function toModel(value: unknown): ModelOption | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as CatalogModel;

  const id = text(source.id);
  if (!id) return undefined;

  const description = text(source.description);
  return {
    id,
    name: text(source.name) ?? id,
    ...(description ? { description } : {}),
    ...effortsOf(source),
  };
}

/** One provider, dropping models that cannot be represented. */
function toGroup(value: unknown): ModelGroup | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as CatalogGroup;

  const id = text(source.id);
  if (!id) return undefined;

  const models = Array.isArray(source.models)
    ? source.models.map(toModel).filter((model): model is ModelOption => model !== undefined)
    : [];

  return { id, name: text(source.name) ?? id, models };
}

/** One failed provider, or `undefined` when it carries no id. */
function toFailure(value: unknown): ModelFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as { id?: unknown; name?: unknown; message?: unknown };

  const id = text(source.id);
  if (!id) return undefined;

  return {
    id,
    name: text(source.name) ?? id,
    message: text(source.message) ?? 'The provider could not be read.',
  };
}

/** Reads the host payload into the contract, tolerating anything unexpected. */
export function toCatalog(payload: unknown): ModelCatalog {
  if (typeof payload !== 'object' || payload === null) return { groups: [], failures: [] };
  const source = payload as CatalogPayload;

  const groups = Array.isArray(source.groups)
    ? source.groups.map(toGroup).filter((group): group is ModelGroup => group !== undefined)
    : [];
  const failures = Array.isArray(source.failures)
    ? source.failures
        .map(toFailure)
        .filter((failure): failure is ModelFailure => failure !== undefined)
    : [];
  const selection = selectionOf(source.default);

  // Un grupo sin modelos no dice nada y ocupa una fila en el selector.
  return {
    ...(selection ? { default: selection } : {}),
    groups: groups.filter((group) => group.models.length > 0),
    failures,
  };
}

/** `true` if this host can describe its models. */
export function canListModels(ctx: HostContext): boolean {
  try {
    return typeof service<ModelController>(ctx, 'sessionController')?.modelCatalog === 'function';
  } catch {
    return false;
  }
}

/** `true` if this host accepts a model choice. */
export function canSelectModel(ctx: HostContext): boolean {
  try {
    return typeof service<ModelController>(ctx, 'sessionController')?.selectModel === 'function';
  } catch {
    return false;
  }
}

/** The host catalog, or an empty one. Never throws: the phone still works. */
export async function listModels(ctx: HostContext): Promise<ModelCatalog> {
  const controller = service<ModelController>(ctx, 'sessionController');
  if (!controller || typeof controller.modelCatalog !== 'function') {
    return { groups: [], failures: [] };
  }

  try {
    return toCatalog(await controller.modelCatalog());
  } catch (error) {
    // El catálogo es una comodidad: sin él se puede seguir escribiendo. Se dice
    // por qué en `failures` para que la app no parezca rota.
    return {
      groups: [],
      failures: [{ id: 'catalog', name: 'Models', message: messageOf(error) }],
    };
  }
}

export type SelectResult =
  | { ok: true; selection: ModelSelection }
  | {
      ok: false;
      code: 'no-service' | 'unavailable' | 'not-found' | 'failed';
      message: string;
    };

/**
 * Selects the model of one session.
 *
 * The host confirms the recorded selection. It does **not** materialize defaults: what
 * comes back is what was asked for, so the phone learns about a rejected route here
 * instead of in the next turn.
 */
export async function selectModel(
  ctx: HostContext,
  request: { sessionId: string; provider: string; model: string; reasoningEffort?: string },
): Promise<SelectResult> {
  const controller = service<ModelController>(ctx, 'sessionController');
  if (!controller || typeof controller.selectModel !== 'function') {
    return { ok: false, code: 'no-service', message: 'This host cannot select models.' };
  }

  try {
    const result = await controller.selectModel({
      sessionId: request.sessionId,
      provider: request.provider,
      model: request.model,
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
    });

    const selection = selectionOf(result?.selected) ?? {
      provider: request.provider,
      model: request.model,
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
    };
    return { ok: true, selection };
  } catch (error) {
    const code = codeOf(error);
    if (code === 'session/model-unavailable') {
      // El mismo código cubre "ese modelo ya no está" y "ese esfuerzo no existe": el
      // mensaje del host es el único que dice cuál, así que no se sustituye.
      return { ok: false, code: 'unavailable', message: messageOf(error) };
    }
    if (code === 'session/not-found' || code === 'workspace/not-found') {
      return { ok: false, code: 'not-found', message: 'That session no longer exists.' };
    }
    return { ok: false, code: 'failed', message: messageOf(error) };
  }
}
