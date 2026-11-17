import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { HostContext, WorkspaceFileScope } from '../host-api.js';
import { filesAvailable, readFile, readFileBytes, statFile } from './files.js';

const ROOT = join(tmpdir(), 'dsh-files-test');
const OUTSIDE = resolve(ROOT, '..', 'secret.txt');
const TRAVERSAL = join('..', 'secret.txt');

interface Call {
  method: 'stat' | 'read' | 'readBytes' | 'render';
  scope: WorkspaceFileScope;
  path: string;
  signal: AbortSignal;
  options?: unknown;
}

const calls: Call[] = [];

function scopeOf(value: unknown): WorkspaceFileScope {
  if (typeof value !== 'object' || value === null) throw new Error('scope must be an object');
  const { sessionId, workspaceRoot } = value as WorkspaceFileScope;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('scope.sessionId must be a string');
  }
  if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) {
    throw new Error('scope.workspaceRoot must be absolute');
  }
  return value as WorkspaceFileScope;
}

function signalOf(value: unknown): AbortSignal {
  if (!(value instanceof AbortSignal)) throw new Error('signal must be an AbortSignal');
  return value;
}

const ctx = {
  sessions: { get: (id: string) => (id === 's-1' ? { id: 's-1' } : undefined) },
  sessionProjections: {
    snapshot: () => ({ asOfSeq: 1, values: { workingDirectory: ROOT } }),
  },
  workspaceFiles: {
    stat: async (scope: unknown, path: unknown, signal: unknown) => {
      calls.push({
        method: 'stat',
        scope: scopeOf(scope),
        path: String(path),
        signal: signalOf(signal),
      });
      return { absolutePath: String(path), version: 'v1', bytes: 120 };
    },
    read: async (scope: unknown, path: unknown, options: unknown, signal: unknown) => {
      calls.push({
        method: 'read',
        scope: scopeOf(scope),
        path: String(path),
        signal: signalOf(signal),
        options,
      });
      const offset = (options as { offset?: number }).offset ?? 1;
      return {
        absolutePath: String(path),
        version: 'v1',
        bytes: 6,
        offset,
        text: '# Demo',
        lines: 1,
        eof: true,
      };
    },
    readBytes: async (scope: unknown, path: unknown, options: unknown, signal: unknown) => {
      calls.push({
        method: 'readBytes',
        scope: scopeOf(scope),
        path: String(path),
        signal: signalOf(signal),
        options,
      });
      return {
        absolutePath: String(path),
        version: 'v1',
        bytes: 3,
        offset: 0,
        data: new Uint8Array([1, 2, 3]),
        eof: true,
      };
    },
  },
} as unknown as HostContext;

function lastCall(method: Call['method']): Call {
  const found = [...calls].reverse().find((call) => call.method === method);
  if (!found) throw new Error(`no ${method} call`);
  return found;
}

describe('filesAvailable', () => {
  it('necesita workspaceFiles', () => {
    expect(filesAvailable(ctx)).toBe(true);
    expect(filesAvailable({} as HostContext)).toBe(false);
  });
});

describe('statFile', () => {
  it('llama al host con el scope y la ruta absoluta', async () => {
    calls.length = 0;
    await expect(statFile(ctx, { sessionId: 's-1', path: 'README.md' })).resolves.toMatchObject({
      ok: true,
      file: { path: 'README.md', name: 'README.md', kind: 'markdown', size: 120 },
    });

    const call = lastCall('stat');
    expect(call.scope).toEqual({ sessionId: 's-1', workspaceRoot: ROOT });
    expect(call.path).toBe(join(ROOT, 'README.md'));
  });

  it('rechaza rutas fuera del workspace', async () => {
    await expect(statFile(ctx, { sessionId: 's-1', path: TRAVERSAL })).resolves.toMatchObject({
      ok: false,
      code: 'bad-request',
    });
    await expect(statFile(ctx, { sessionId: 's-1', path: OUTSIDE })).resolves.toMatchObject({
      ok: false,
      code: 'bad-request',
    });
  });

  it('rechaza un sessionId desconocido', async () => {
    await expect(statFile(ctx, { sessionId: 'nope', path: 'README.md' })).resolves.toMatchObject({
      ok: false,
      code: 'bad-request',
    });
  });

  it('traduce el rechazo del host a un mensaje propio', async () => {
    const refusing = {
      ...(ctx as unknown as Record<string, unknown>),
      workspaceFiles: {
        stat: async () => {
          throw Object.assign(new Error('nope'), { code: 'workspace-file/outside-workspace' });
        },
        read: async () => {
          throw new Error('no');
        },
        readBytes: async () => {
          throw new Error('no');
        },
      },
    } as unknown as HostContext;

    await expect(
      statFile(refusing, { sessionId: 's-1', path: 'README.md' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'bad-request',
      message: 'The file is outside the session workspace.',
    });
  });

  it('prefiere el cwd del header de la sesión', async () => {
    calls.length = 0;
    const other = join(tmpdir(), 'dsh-files-other');
    const withHeader = {
      ...(ctx as unknown as Record<string, unknown>),
      sessions: { get: () => ({ id: 's-1', header: { cwd: other } }) },
    } as unknown as HostContext;

    await statFile(withHeader, { sessionId: 's-1', path: 'README.md' });
    expect(lastCall('stat').scope.workspaceRoot).toBe(other);
  });

  it('resuelve el workspace de una sesión guardada', async () => {
    calls.length = 0;
    const stored = join(tmpdir(), 'dsh-files-stored');
    const withPersistence = {
      ...(ctx as unknown as Record<string, unknown>),
      sessions: { get: () => undefined },
      sessionProjections: { snapshot: () => ({ asOfSeq: 1, values: {} }) },
      sessionPersistence: { stat: async () => ({ header: { cwd: stored } }) },
    } as unknown as HostContext;

    await expect(
      statFile(withPersistence, { sessionId: 's-2', path: 'docs/a.md' }),
    ).resolves.toMatchObject({ ok: true });
    expect(lastCall('stat').scope).toEqual({ sessionId: 's-2', workspaceRoot: stored });
  });

  it('cae al workspace del despliegue sin sesión', async () => {
    calls.length = 0;
    const fallback = join(tmpdir(), 'dsh-files-fallback');
    const withSandbox = {
      ...(ctx as unknown as Record<string, unknown>),
      sessions: { get: () => undefined },
      sessionProjections: { snapshot: () => ({ asOfSeq: 1, values: {} }) },
      sessionPersistence: { stat: async () => undefined },
      workspaceController: { list: async () => ({ items: [] }) },
      sandboxPolicy: { workspaceRoot: fallback },
    } as unknown as HostContext;

    await statFile(withSandbox, { sessionId: 's-3', path: 'README.md' });
    expect(lastCall('stat').scope).toEqual({ sessionId: 's-3', workspaceRoot: fallback });
  });

  it('usa la carpeta del workspace que lista la sesión guardada', async () => {
    calls.length = 0;
    const directory = join(tmpdir(), 'dsh-files-workspace');
    const withRegistry = {
      ...(ctx as unknown as Record<string, unknown>),
      sessions: { get: () => undefined },
      sessionProjections: { snapshot: () => ({ asOfSeq: 1, values: {} }) },
      sessionPersistence: { stat: async () => undefined },
      workspaceController: {
        list: async () => ({
          items: [
            { workspaceId: 'w-1', path: join(tmpdir(), 'otro'), title: 'Otro', sessionIds: [] },
            { workspaceId: 'w-2', path: directory, title: 'Este', sessionIds: ['s-9'] },
          ],
        }),
      },
    } as unknown as HostContext;

    await statFile(withRegistry, { sessionId: 's-9', path: 'docs/a.md' });
    expect(lastCall('stat').scope).toEqual({ sessionId: 's-9', workspaceRoot: directory });
  });

  it('no inventa un workspace si nadie lo declara', async () => {
    const missing = {
      ...(ctx as unknown as Record<string, unknown>),
      sessions: { get: () => undefined },
      sessionProjections: { snapshot: () => ({ asOfSeq: 1, values: {} }) },
      sessionPersistence: { stat: async () => undefined },
      workspaceController: { list: async () => ({ items: [] }) },
    } as unknown as HostContext;

    await expect(statFile(missing, { sessionId: 's-4', path: 'README.md' })).resolves.toMatchObject(
      {
        ok: false,
        code: 'bad-request',
        message: 'Files are not available here.',
      },
    );
  });
});

describe('readFile', () => {
  it('entrega el texto de un markdown con el page cap del host', async () => {
    calls.length = 0;
    await expect(readFile(ctx, { sessionId: 's-1', path: 'README.md' })).resolves.toMatchObject({
      ok: true,
      text: '# Demo',
      offset: 1,
      eof: true,
    });

    const call = lastCall('read');
    expect(call.path).toBe(join(ROOT, 'README.md'));
    expect(call.options).toEqual({ limit: 2_000 });
  });

  it('reenvía el offset de paginación', async () => {
    calls.length = 0;
    await readFile(ctx, { sessionId: 's-1', path: 'README.md', offset: 400 });
    expect(lastCall('read').options).toEqual({ offset: 400, limit: 2_000 });
  });

  it('no entrega texto de una imagen', async () => {
    await expect(readFile(ctx, { sessionId: 's-1', path: 'logo.png' })).resolves.toMatchObject({
      ok: false,
      code: 'bad-request',
    });
  });
});

describe('readFileBytes', () => {
  it('entrega bytes en base64 para una imagen con opciones vacías', async () => {
    calls.length = 0;
    await expect(readFileBytes(ctx, { sessionId: 's-1', path: 'logo.png' })).resolves.toMatchObject(
      {
        ok: true,
        mime: 'image/png',
        data: Buffer.from([1, 2, 3]).toString('base64'),
      },
    );

    const call = lastCall('readBytes');
    expect(call.path).toBe(join(ROOT, 'logo.png'));
    expect(call.options).toEqual({});
  });

  it('no entrega bytes de un markdown', async () => {
    await expect(
      readFileBytes(ctx, { sessionId: 's-1', path: 'README.md' }),
    ).resolves.toMatchObject({ ok: false, code: 'bad-request' });
  });

  it('convierte un Office a PDF con officeKit', async () => {
    calls.length = 0;
    const withOffice = {
      ...(ctx as unknown as Record<string, unknown>),
      officeKit: {
        render: async (scope: unknown, path: unknown, _priority: unknown, signal: unknown) => {
          calls.push({
            method: 'render',
            scope: scopeOf(scope),
            path: String(path),
            signal: signalOf(signal),
          });
          return { data: new Uint8Array([37, 80, 68, 70]), bytes: 4 };
        },
      },
    } as unknown as HostContext;

    await expect(
      readFileBytes(withOffice, { sessionId: 's-1', path: 'informe.docx' }),
    ).resolves.toMatchObject({ ok: true, mime: 'application/pdf' });

    const call = lastCall('render');
    expect(call.scope).toEqual({ sessionId: 's-1', workspaceRoot: ROOT });
    expect(call.path).toBe(join(ROOT, 'informe.docx'));
  });

  it('rechaza un Office si el host no convierte', async () => {
    await expect(
      readFileBytes(ctx, { sessionId: 's-1', path: 'informe.docx' }),
    ).resolves.toMatchObject({ ok: false, code: 'bad-request' });
  });
});

describe('reintentos', () => {
  it('reintenta una vez un fallo transitorio del host', async () => {
    let attempts = 0;
    const flaky = {
      ...(ctx as unknown as Record<string, unknown>),
      workspaceFiles: {
        stat: async (_scope: unknown, path: unknown) => {
          attempts += 1;
          if (attempts === 1) throw Object.assign(new Error('EIO'), { code: 'EIO' });
          return { absolutePath: String(path), version: 'v1', bytes: 9 };
        },
        read: async () => {
          throw new Error('no');
        },
        readBytes: async () => {
          throw new Error('no');
        },
      },
    } as unknown as HostContext;

    await expect(statFile(flaky, { sessionId: 's-1', path: 'README.md' })).resolves.toMatchObject({
      ok: true,
      file: { size: 9 },
    });
    expect(attempts).toBe(2);
  });

  it('no reintenta un archivo que no existe', async () => {
    let attempts = 0;
    const missing = {
      ...(ctx as unknown as Record<string, unknown>),
      workspaceFiles: {
        stat: async () => {
          attempts += 1;
          throw Object.assign(new Error('gone'), { code: 'workspace-file/not-found' });
        },
        read: async () => {
          throw new Error('no');
        },
        readBytes: async () => {
          throw new Error('no');
        },
      },
    } as unknown as HostContext;

    await expect(statFile(missing, { sessionId: 's-1', path: 'README.md' })).resolves.toMatchObject(
      {
        ok: false,
        code: 'not-found',
      },
    );
    expect(attempts).toBe(1);
  });
});
