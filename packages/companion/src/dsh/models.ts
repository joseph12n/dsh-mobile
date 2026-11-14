import { service, type HostContext } from '../host-api.js';
import type {
  ModelCatalog,
  ModelFailure,
  ModelGroup,
  ModelOption,
  ModelSelection,
} from '@deepseekharness-mobile/protocol';
import { codeOf, messageOf } from './errors.js';

interface CatalogGroup {
  id?: unknown;
  name?: unknown;
  models?: unknown;
}

interface CatalogModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  reasoning?: { efforts?: unknown; defaultEffort?: unknown };
}

interface CatalogPayload {
  default?: unknown;
  groups?: unknown;
  failures?: unknown;
}

export interface ModelController {
  modelCatalog?: () => Promise<CatalogPayload>;
  selectModel?: (request: {
    sessionId: string;
    provider: string;
    model: string;
    reasoningEffort?: string;
  }) => Promise<{ selected?: unknown }>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

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

  return {
    ...(selection ? { default: selection } : {}),
    groups: groups.filter((group) => group.models.length > 0),
    failures,
  };
}

export function canListModels(ctx: HostContext): boolean {
  try {
    return typeof service<ModelController>(ctx, 'sessionController')?.modelCatalog === 'function';
  } catch {
    return false;
  }
}

export function canSelectModel(ctx: HostContext): boolean {
  try {
    return typeof service<ModelController>(ctx, 'sessionController')?.selectModel === 'function';
  } catch {
    return false;
  }
}

export async function listModels(ctx: HostContext): Promise<ModelCatalog> {
  const controller = service<ModelController>(ctx, 'sessionController');
  if (!controller || typeof controller.modelCatalog !== 'function') {
    return { groups: [], failures: [] };
  }

  try {
    return toCatalog(await controller.modelCatalog());
  } catch (error) {
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
      return { ok: false, code: 'unavailable', message: messageOf(error) };
    }
    if (code === 'session/not-found' || code === 'workspace/not-found') {
      return { ok: false, code: 'not-found', message: 'That session no longer exists.' };
    }
    return { ok: false, code: 'failed', message: messageOf(error) };
  }
}
