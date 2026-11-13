import type {
  ProviderConnection,
  ProviderCredential,
  ProviderTestResult,
  ProviderView,
} from '@dsh-mobile/protocol';
import {
  service,
  type ConfigurableProvider,
  type CredentialsService,
  type HostContext,
  type LlmService,
  type SettingsService,
} from '../host-api.js';

const API_KEY = /^[\x21-\x7E]+$/;
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_KEY_LENGTH = 8_192;
const TEST_TIMEOUT_MS = 8_000;

export interface ProviderOutcome {
  ok: boolean;
  code?: 'bad-request' | 'internal';
  message?: string;
  connection?: ProviderConnection;
}

function services(ctx: HostContext): {
  llm: LlmService | undefined;
  settings: SettingsService | undefined;
  credentials: CredentialsService | undefined;
} {
  return {
    llm: service<LlmService>(ctx, 'llm'),
    settings: service<SettingsService>(ctx, 'settings'),
    credentials: service<CredentialsService>(ctx, 'credentials'),
  };
}

export function providersAvailable(ctx: HostContext): boolean {
  const { llm, settings, credentials } = services(ctx);
  return (
    typeof llm?.listProviders === 'function' &&
    typeof llm?.listConfigurableProviders === 'function' &&
    typeof settings?.describe === 'function' &&
    typeof credentials?.describe === 'function'
  );
}

export function providerConnectAvailable(ctx: HostContext): boolean {
  const { settings, credentials } = services(ctx);
  return (
    providersAvailable(ctx) &&
    typeof settings?.update === 'function' &&
    typeof credentials?.set === 'function' &&
    typeof credentials?.unset === 'function'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function catalog(llm: LlmService): readonly ConfigurableProvider[] {
  try {
    return llm.listConfigurableProviders();
  } catch {
    return [];
  }
}

function findEntry(llm: LlmService, provider: string): ConfigurableProvider | undefined {
  return catalog(llm).find((entry) => entry.provider === provider);
}

function descriptorFor(settings: SettingsService, ns: string) {
  try {
    return settings.describe({ redactSecrets: true }).find((item) => item.ns === ns);
  } catch {
    return undefined;
  }
}

function profileAt(
  settings: SettingsService,
  entry: ConfigurableProvider,
): Record<string, unknown> | undefined {
  const descriptor = descriptorFor(settings, entry.settingsNs);
  if (!descriptor) return undefined;

  let value: unknown = descriptor.value;
  for (const segment of entry.settingsPath) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }

  return isRecord(value) ? value : undefined;
}

function refOf(profile: Record<string, unknown> | undefined): string | undefined {
  const ref = profile?.['apiKeyEnv'];
  return typeof ref === 'string' && CREDENTIAL_REF.test(ref) ? ref : undefined;
}

function deriveRef(provider: string): string {
  const base = provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `${/^[A-Z_]/.test(base) ? base : `PROVIDER_${base}`}_API_KEY`;
}

function allRefs(llm: LlmService, settings: SettingsService): Set<string> {
  const refs = new Set<string>();
  for (const entry of catalog(llm)) {
    const ref = refOf(profileAt(settings, entry));
    if (ref) refs.add(ref);
  }
  return refs;
}

function validateKey(raw: string): string | undefined {
  const key = raw.trim();
  if (!key || key.length > MAX_KEY_LENGTH || !API_KEY.test(key)) return undefined;
  return key;
}

function scrub(detail: string | undefined, key: string): string | undefined {
  if (!detail) return undefined;
  return detail.split(key).join('***');
}

function classifyTestError(error: unknown): ProviderTestResult['code'] {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    isRecord(error) && typeof error['code'] === 'string' ? (error['code'] as string) : '';
  const status =
    isRecord(error) && typeof error['status'] === 'number'
      ? (error['status'] as number)
      : undefined;
  const text = `${code} ${message}`.toLowerCase();

  if (text.includes('no_discovery') || text.includes('no model discovery')) return 'unsupported';
  if (
    status === 401 ||
    status === 403 ||
    text.includes('401') ||
    text.includes('403') ||
    text.includes('api key') ||
    text.includes('unauthorized') ||
    text.includes('forbidden')
  )
    return 'rejected';
  if (
    text.includes('abort') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('fetch failed') ||
    text.includes('enotfound') ||
    text.includes('econn')
  )
    return 'unreachable';
  return 'rejected';
}

export async function listProviders(ctx: HostContext): Promise<ProviderView[]> {
  const { llm, settings, credentials } = services(ctx);
  if (!llm || !settings || !credentials) return [];

  let routes: readonly { id: string; name?: string }[];
  try {
    routes = llm.listProviders();
  } catch {
    return [];
  }

  const configured = new Set(routes.map((route) => route.id));
  const views: ProviderView[] = [];
  const seen = new Set<string>();

  for (const entry of catalog(llm)) {
    seen.add(entry.provider);
    const profile = profileAt(settings, entry);
    const ref = refOf(profile);

    let credential: ProviderCredential = 'unknown';
    let credentialSource: ProviderView['credentialSource'];
    if (ref) {
      try {
        const description = await credentials.describe(ref);
        credential = description.configured ? 'set' : 'missing';
        credentialSource = description.source;
      } catch {}
    }

    const action =
      entry.nativeAuth && !profile
        ? 'desktop'
        : !profile
          ? 'add-provider'
          : credential === 'set'
            ? 'none'
            : 'add-key';

    views.push({
      id: entry.provider,
      name: entry.displayName,
      configured: configured.has(entry.provider),
      credential,
      ...(credentialSource ? { credentialSource } : {}),
      action,
    });
  }

  for (const route of routes) {
    if (seen.has(route.id)) continue;
    views.push({
      id: route.id,
      name: route.name ?? route.id,
      configured: true,
      credential: 'unknown',
      action: 'desktop',
    });
  }

  return views.sort((left, right) => {
    if (left.configured !== right.configured) return left.configured ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export async function testProvider(
  ctx: HostContext,
  input: { provider: string; apiKey: string },
): Promise<ProviderTestResult> {
  const { llm, settings } = services(ctx);
  if (!llm || !settings) return { provider: input.provider, ok: false, code: 'unsupported' };

  const entry = findEntry(llm, input.provider);
  if (!entry) {
    return { provider: input.provider, ok: false, code: 'invalid', detail: 'Unknown provider.' };
  }

  const key = validateKey(input.apiKey);
  if (!key) {
    return {
      provider: input.provider,
      ok: false,
      code: 'invalid',
      detail: 'The key is empty, too long or has characters a header cannot carry.',
    };
  }

  const profile = profileAt(settings, entry);
  const baseURL =
    typeof profile?.['baseURL'] === 'string' ? profile['baseURL'] : entry.defaultBaseURL;
  const api = typeof profile?.['api'] === 'string' ? profile['api'] : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    await llm.discoverModels(
      entry.settingsNs,
      {
        provider: entry.provider,
        ...(baseURL ? { baseURL } : {}),
        ...(api ? { api } : {}),
        apiKey: key,
      },
      controller.signal,
    );
    return { provider: input.provider, ok: true, code: 'ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: input.provider,
      ok: false,
      code: classifyTestError(error),
      ...(message ? { detail: scrub(message, key) } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function connectProvider(
  ctx: HostContext,
  input: { provider: string; apiKey: string },
): Promise<ProviderOutcome> {
  const { llm, settings, credentials } = services(ctx);
  if (!llm || !settings || !credentials) {
    return { ok: false, code: 'bad-request', message: 'This host cannot configure providers.' };
  }

  const entry = findEntry(llm, input.provider);
  if (!entry) {
    return { ok: false, code: 'bad-request', message: 'Unknown provider.' };
  }
  if (entry.nativeAuth) {
    return {
      ok: false,
      code: 'bad-request',
      message: 'This provider signs in on the desktop.',
    };
  }

  const key = validateKey(input.apiKey);
  if (!key) {
    return {
      ok: false,
      code: 'bad-request',
      message: 'The key is empty, too long or has characters a header cannot carry.',
    };
  }

  const profile = profileAt(settings, entry);
  const existingRef = refOf(profile);
  const ref = existingRef ?? deriveRef(entry.provider);

  if (!existingRef && allRefs(llm, settings).has(ref)) {
    return {
      ok: false,
      code: 'bad-request',
      message: 'The derived credential name is already used by another provider.',
    };
  }

  try {
    await credentials.set(ref, key);
  } catch {
    return { ok: false, code: 'internal', message: 'The key could not be stored on the host.' };
  }

  if (!profile) {
    const descriptor = descriptorFor(settings, entry.settingsNs);
    if (!descriptor) {
      return {
        ok: false,
        code: 'internal',
        message: 'The key was stored, but the provider settings are not available.',
      };
    }

    const patch = entry.settingsPath.reduceRight<Record<string, unknown>>(
      (value, segment) => ({ [segment]: value }),
      { apiKeyEnv: ref },
    );

    try {
      await settings.update(entry.settingsNs, patch, descriptor.revision);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        code: 'internal',
        message: `The key was stored, but the provider could not be added: ${detail}`,
      };
    }
  }

  return {
    ok: true,
    connection: { provider: entry.provider, credential: 'set' },
  };
}

export async function disconnectProvider(
  ctx: HostContext,
  input: { provider: string },
): Promise<ProviderOutcome> {
  const { llm, settings, credentials } = services(ctx);
  if (!llm || !settings || !credentials) {
    return { ok: false, code: 'bad-request', message: 'This host cannot configure providers.' };
  }

  const entry = findEntry(llm, input.provider);
  if (!entry) {
    return { ok: false, code: 'bad-request', message: 'Unknown provider.' };
  }

  const ref = refOf(profileAt(settings, entry));
  if (!ref) {
    return { ok: false, code: 'bad-request', message: 'This provider has no stored key.' };
  }

  try {
    await credentials.unset(ref);
  } catch {
    return { ok: false, code: 'internal', message: 'The key could not be removed.' };
  }

  let connection: ProviderConnection = { provider: entry.provider, credential: 'unknown' };
  try {
    const description = await credentials.describe(ref);
    connection = {
      provider: entry.provider,
      credential: description.configured ? 'set' : 'missing',
      ...(description.source ? { credentialSource: description.source } : {}),
    };
  } catch {}

  return { ok: true, connection };
}

export { classifyTestError as providerTestCode };
