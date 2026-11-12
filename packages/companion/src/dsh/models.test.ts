import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { canListModels, canSelectModel, listModels, selectModel, toCatalog } from './models.js';

/**
 * Model selection, against the host shapes read from
 * `@deepseek-ai/dsh-api-session-controller` 0.2.2-rc.1.
 *
 * The catalog is not rebuilt here from `ctx.llm`: a copy would drift from what the
 * desktop offers. Everything is delegated to `sessionController.modelCatalog()`.
 */

/** An error the way the host throws it: a stable code plus a message. */
function coded(code: string, message = 'no'): Error {
  return Object.assign(new Error(message), { code });
}

function ctxWith(services: Record<string, unknown>): HostContext {
  return { get: (name: string) => services[name], ...services } as unknown as HostContext;
}

const catalog = {
  default: { provider: 'deepseek', model: 'chat' },
  routableProviders: ['deepseek'],
  groups: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        {
          id: 'chat',
          name: 'DeepSeek Chat',
          description: 'the usual one',
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High', description: 'slower' },
            ],
            defaultEffort: 'low',
          },
        },
        { id: 'coder', name: 'Coder' },
      ],
    },
  ],
  failures: [{ id: 'other', name: 'Other', message: 'no credentials' }],
};

describe('reading the catalog', () => {
  it('translates the host catalog, efforts included', async () => {
    const ctx = ctxWith({ sessionController: { modelCatalog: async () => catalog } });

    expect(await listModels(ctx)).toEqual({
      default: { provider: 'deepseek', model: 'chat' },
      groups: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          models: [
            {
              id: 'chat',
              name: 'DeepSeek Chat',
              description: 'the usual one',
              reasoningEfforts: [
                { id: 'low', name: 'Low' },
                { id: 'high', name: 'High', description: 'slower' },
              ],
              defaultReasoningEffort: 'low',
            },
            { id: 'coder', name: 'Coder' },
          ],
        },
      ],
      failures: [{ id: 'other', name: 'Other', message: 'no credentials' }],
    });
  });

  it('returns an empty catalog when the host has no controller', async () => {
    expect(await listModels(ctxWith({}))).toEqual({ groups: [], failures: [] });
    expect(canListModels(ctxWith({}))).toBe(false);
  });

  it('explains a host that throws instead of pretending there are no models', async () => {
    const ctx = ctxWith({
      sessionController: {
        modelCatalog: async () => {
          throw new Error('boom');
        },
      },
    });

    const result = await listModels(ctx);
    expect(result.groups).toEqual([]);
    expect(result.failures[0]).toMatchObject({ message: 'boom' });
  });

  it('drops a group with no models: an empty row in a picker is noise', () => {
    const result = toCatalog({ groups: [{ id: 'p', name: 'P', models: [] }], failures: [] });
    expect(result.groups).toEqual([]);
  });

  it('drops rows without an id instead of displaying a nameless model', () => {
    const result = toCatalog({
      groups: [{ id: 'p', name: 'P', models: [{ name: 'no id' }, { id: 'm' }] }],
      failures: [],
    });
    expect(result.groups[0]?.models).toEqual([{ id: 'm', name: 'm' }]);
  });

  it('survives a payload that is not an object', () => {
    expect(toCatalog(null)).toEqual({ groups: [], failures: [] });
    expect(toCatalog('nope')).toEqual({ groups: [], failures: [] });
  });
});

describe('selecting a model', () => {
  it('returns the selection the host normalized', async () => {
    const seen: unknown[] = [];
    const ctx = ctxWith({
      sessionController: {
        selectModel: async (request: unknown) => {
          seen.push(request);
          return { selected: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } };
        },
      },
    });

    const result = await selectModel(ctx, {
      sessionId: 's1',
      provider: 'deepseek',
      model: 'chat',
      reasoningEffort: 'high',
    });

    expect(result).toEqual({
      ok: true,
      selection: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
    });
    // Sin `requestId` ni envoltorios: la firma real es plana.
    expect(seen).toEqual([
      { sessionId: 's1', provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
    ]);
  });

  it('omits an absent effort instead of sending an empty string', async () => {
    const seen: unknown[] = [];
    const ctx = ctxWith({
      sessionController: {
        selectModel: async (request: unknown) => {
          seen.push(request);
          return { selected: { provider: 'p', model: 'm' } };
        },
      },
    });

    await selectModel(ctx, { sessionId: 's1', provider: 'p', model: 'm' });
    expect(seen).toEqual([{ sessionId: 's1', provider: 'p', model: 'm' }]);
  });

  it('reports a model that is no longer available, keeping the host message', async () => {
    // El código cubre "modelo borrado" y "esfuerzo no soportado": el texto del host es
    // lo único que distingue los dos casos.
    const ctx = ctxWith({
      sessionController: {
        selectModel: async () => {
          throw coded('session/model-unavailable', 'Could not resolve reasoning effort');
        },
      },
    });

    expect(await selectModel(ctx, { sessionId: 's1', provider: 'p', model: 'gone' })).toEqual({
      ok: false,
      code: 'unavailable',
      message: 'Could not resolve reasoning effort',
    });
  });

  it('reports a session that no longer exists', async () => {
    const ctx = ctxWith({
      sessionController: {
        selectModel: async () => {
          throw coded('session/not-found');
        },
      },
    });

    expect(await selectModel(ctx, { sessionId: 'gone', provider: 'p', model: 'm' })).toMatchObject({
      ok: false,
      code: 'not-found',
    });
  });

  it('keeps an unexpected failure as failed, not as unavailable', async () => {
    const ctx = ctxWith({
      sessionController: {
        selectModel: async () => {
          throw new Error('disk on fire');
        },
      },
    });

    expect(await selectModel(ctx, { sessionId: 's1', provider: 'p', model: 'm' })).toMatchObject({
      ok: false,
      code: 'failed',
      message: 'disk on fire',
    });
  });

  it('keeps an unknown host code as failed', async () => {
    const ctx = ctxWith({
      sessionController: {
        selectModel: async () => {
          throw Object.assign(new Error('weird'), { code: 'session/something-else' });
        },
      },
    });

    expect(await selectModel(ctx, { sessionId: 's1', provider: 'p', model: 'm' })).toMatchObject({
      ok: false,
      code: 'failed',
    });
  });

  it('refuses when the host cannot select', async () => {
    const ctx = ctxWith({ sessionController: { modelCatalog: async () => catalog } });
    expect(canSelectModel(ctx)).toBe(false);
    expect(await selectModel(ctx, { sessionId: 's1', provider: 'p', model: 'm' })).toMatchObject({
      ok: false,
      code: 'no-service',
    });
  });
});
