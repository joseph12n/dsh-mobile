import { describe, expect, it, vi } from 'vitest';
import type { HostContext } from '../host-api.js';
import {
  connectProvider,
  disconnectProvider,
  listProviders,
  providerConnectAvailable,
  providersAvailable,
  testProvider,
} from './providers.js';

const KEY = 'sk-test-12345';

interface FakeOptions {
  routes?: Array<{ id: string; name?: string }>;
  catalog?: Array<Record<string, unknown>>;
  descriptors?: Array<{ ns: string; revision: number; value: unknown }>;
  credentials?: Map<string, string>;
  updateError?: boolean;
  discover?: () => Promise<Array<{ id: string }>>;
}

const baseCatalog = [
  {
    provider: 'opencode',
    displayName: 'OpenCode',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'opencode'],
    defaultBaseURL: 'https://opencode.example/v1',
  },
  {
    provider: 'newprov',
    displayName: 'New Provider',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'newprov'],
    defaultBaseURL: 'https://new.example/v1',
  },
  {
    provider: 'native',
    displayName: 'Native Auth',
    settingsNs: 'llm-native',
    settingsPath: [],
    nativeAuth: { oauth: true },
  },
];

function context(options: FakeOptions = {}): {
  ctx: HostContext;
  store: Map<string, string>;
  update: ReturnType<typeof vi.fn>;
} {
  const store = options.credentials ?? new Map<string, string>();
  const update = vi.fn(async () => {
    if (options.updateError) throw new Error('conflict');
  });
  const ctx = {
    llm: {
      listProviders: () => options.routes ?? [{ id: 'opencode', name: 'OpenCode' }],
      listConfigurableProviders: () => options.catalog ?? baseCatalog,
      discoverModels: options.discover ?? (async () => [{ id: 'model-1' }]),
    },
    settings: {
      describe: () =>
        options.descriptors ?? [
          {
            ns: 'llm-pi-ai',
            revision: 3,
            value: { providers: { opencode: { apiKeyEnv: 'OPENCODE_KEY' } } },
          },
        ],
      update,
    },
    credentials: {
      describe: async (ref: string) =>
        store.has(ref) ? { configured: true, source: 'file' } : { configured: false },
      set: async (ref: string, value: string) => {
        store.set(ref, value);
      },
      unset: async (ref: string) => {
        store.delete(ref);
      },
    },
  } as unknown as HostContext;
  return { ctx, store, update };
}

describe('providersAvailable', () => {
  it('exige llm, settings y credenciales', () => {
    const { ctx } = context();
    expect(providersAvailable(ctx)).toBe(true);
    expect(providerConnectAvailable(ctx)).toBe(true);
    expect(providersAvailable({} as HostContext)).toBe(false);
  });
});

describe('listProviders', () => {
  it('marca la clave ausente y la acción de añadirla', async () => {
    const { ctx } = context();

    await expect(listProviders(ctx)).resolves.toEqual([
      {
        id: 'opencode',
        name: 'OpenCode',
        configured: true,
        credential: 'missing',
        action: 'add-key',
      },
      {
        id: 'native',
        name: 'Native Auth',
        configured: false,
        credential: 'unknown',
        action: 'add-provider',
      },
      {
        id: 'newprov',
        name: 'New Provider',
        configured: false,
        credential: 'unknown',
        action: 'add-provider',
      },
    ]);
  });

  it('marca la clave presente y la acción none', async () => {
    const store = new Map([['OPENCODE_KEY', KEY]]);
    const { ctx } = context({ credentials: store });

    const providers = await listProviders(ctx);
    expect(providers.find((item) => item.id === 'opencode')).toMatchObject({
      credential: 'set',
      credentialSource: 'file',
      action: 'none',
    });
  });

  it('incluye rutas configuradas que no están en el catálogo', async () => {
    const { ctx } = context({ catalog: [], routes: [{ id: 'legacy', name: 'Legacy' }] });

    await expect(listProviders(ctx)).resolves.toEqual([
      {
        id: 'legacy',
        name: 'Legacy',
        configured: true,
        credential: 'unknown',
        action: 'desktop',
      },
    ]);
  });
});

describe('testProvider', () => {
  it('devuelve ok cuando el descubrimiento responde', async () => {
    const { ctx } = context();
    await expect(testProvider(ctx, { provider: 'opencode', apiKey: KEY })).resolves.toEqual({
      provider: 'opencode',
      ok: true,
      code: 'ok',
    });
  });

  it('clasifica un 401 como rechazada y no filtra la clave', async () => {
    const { ctx } = context({
      discover: async () => {
        throw new Error(`401 unauthorized for key ${KEY}`);
      },
    });

    const result = await testProvider(ctx, { provider: 'opencode', apiKey: KEY });
    expect(result).toMatchObject({ ok: false, code: 'rejected' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('marca la falta de descubrimiento como unsupported', async () => {
    const { ctx } = context({
      discover: async () => {
        const error = new Error('no model discovery is registered');
        (error as Error & { code?: string }).code = 'NO_DISCOVERY';
        throw error;
      },
    });
    await expect(testProvider(ctx, { provider: 'opencode', apiKey: KEY })).resolves.toMatchObject({
      ok: false,
      code: 'unsupported',
    });
  });

  it('rechaza una clave inválida o un proveedor desconocido sin llamar al descubrimiento', async () => {
    const discover = vi.fn(async () => [{ id: 'm' }]);
    const { ctx } = context({ discover });

    await expect(
      testProvider(ctx, { provider: 'opencode', apiKey: ' bad key ' }),
    ).resolves.toMatchObject({ ok: false, code: 'invalid' });
    await expect(testProvider(ctx, { provider: 'nope', apiKey: KEY })).resolves.toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(discover).not.toHaveBeenCalled();
  });
});

describe('connectProvider', () => {
  it('guarda la clave de un proveedor ya declarado sin tocar settings', async () => {
    const { ctx, store, update } = context();

    const outcome = await connectProvider(ctx, { provider: 'opencode', apiKey: KEY });
    expect(outcome).toMatchObject({
      ok: true,
      connection: { provider: 'opencode', credential: 'set' },
    });
    expect(store.get('OPENCODE_KEY')).toBe(KEY);
    expect(update).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('añade el proveedor y su referencia derivada', async () => {
    const { ctx, store, update } = context();

    const outcome = await connectProvider(ctx, { provider: 'newprov', apiKey: KEY });
    expect(outcome).toMatchObject({
      ok: true,
      connection: { provider: 'newprov', credential: 'set' },
    });
    expect(store.get('NEWPROV_API_KEY')).toBe(KEY);
    expect(update).toHaveBeenCalledWith(
      'llm-pi-ai',
      { providers: { newprov: { apiKeyEnv: 'NEWPROV_API_KEY' } } },
      3,
    );
  });

  it('no conecta si la actualización falla y avisa de que la clave quedó guardada', async () => {
    const { ctx, store } = context({ updateError: true });

    const outcome = await connectProvider(ctx, { provider: 'newprov', apiKey: KEY });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('provider could not be added');
    expect(store.get('NEWPROV_API_KEY')).toBe(KEY);
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('intenta la clave de un proveedor con autenticación nativa y avisa si faltan sus ajustes', async () => {
    const { ctx, store } = context();

    const outcome = await connectProvider(ctx, { provider: 'native', apiKey: KEY });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('settings');
    expect(store.get('NATIVE_API_KEY')).toBe(KEY);
  });

  it('rechaza proveedores desconocidos y claves inválidas', async () => {
    const { ctx, store } = context();

    await expect(connectProvider(ctx, { provider: 'nope', apiKey: KEY })).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      connectProvider(ctx, { provider: 'opencode', apiKey: 'x y' }),
    ).resolves.toMatchObject({
      ok: false,
    });
    expect(store.size).toBe(0);
  });
});

describe('disconnectProvider', () => {
  it('borra la referencia y devuelve missing o el fallback de entorno', async () => {
    const store = new Map([['OPENCODE_KEY', KEY]]);
    const { ctx } = context({ credentials: store });

    await expect(disconnectProvider(ctx, { provider: 'opencode' })).resolves.toEqual({
      ok: true,
      connection: { provider: 'opencode', credential: 'missing' },
    });
    expect(store.size).toBe(0);
  });
});
