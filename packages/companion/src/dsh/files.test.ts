import { describe, expect, it } from 'vitest';
import type { HostContext } from '../host-api.js';
import { filesAvailable, readFile, readFileBytes, statFile } from './files.js';

const ROOT = 'C:\\work\\demo';

const ctx = {
  sessions: { get: (id: string) => (id === 's-1' ? { id: 's-1' } : undefined) },
  sessionProjections: {
    snapshot: () => ({ asOfSeq: 1, values: { workingDirectory: ROOT } }),
  },
  workspaceFiles: {
    stat: async (_sessionId: string, path: string) => ({
      absolutePath: `${ROOT}\\${path}`,
      bytes: 120,
    }),
    read: async (
      _sessionId: string,
      path: string,
      options?: { offset?: number; limit?: number },
    ) => ({
      absolutePath: `${ROOT}\\${path}`,
      bytes: 120,
      offset: options?.offset ?? 0,
      text: '# Demo',
      lines: 1,
      eof: true,
    }),
    readBytes: async (_sessionId: string, path: string) => ({
      absolutePath: `${ROOT}\\${path}`,
      bytes: 3,
      offset: 0,
      data: new Uint8Array([1, 2, 3]),
      eof: true,
    }),
  },
} as unknown as HostContext;

describe('filesAvailable', () => {
  it('necesita workspaceFiles', () => {
    expect(filesAvailable(ctx)).toBe(true);
    expect(filesAvailable({} as HostContext)).toBe(false);
  });
});

describe('statFile', () => {
  it('devuelve tipo y tamaño de un archivo del workspace', async () => {
    await expect(statFile(ctx, { sessionId: 's-1', path: 'README.md' })).resolves.toMatchObject({
      ok: true,
      file: { path: 'README.md', name: 'README.md', kind: 'markdown', size: 120 },
    });
  });

  it('rechaza rutas fuera del workspace', async () => {
    await expect(
      statFile(ctx, { sessionId: 's-1', path: '..\\secret.txt' }),
    ).resolves.toMatchObject({ ok: false, code: 'bad-request' });
    await expect(
      statFile(ctx, { sessionId: 's-1', path: 'C:\\Windows\\win.ini' }),
    ).resolves.toMatchObject({ ok: false, code: 'bad-request' });
  });

  it('rechaza un sessionId desconocido', async () => {
    await expect(statFile(ctx, { sessionId: 'nope', path: 'README.md' })).resolves.toMatchObject({
      ok: false,
      code: 'bad-request',
    });
  });
});

describe('readFile', () => {
  it('entrega el texto de un markdown', async () => {
    await expect(readFile(ctx, { sessionId: 's-1', path: 'README.md' })).resolves.toMatchObject({
      ok: true,
      text: '# Demo',
      offset: 0,
      eof: true,
    });
  });

  it('no entrega texto de una imagen', async () => {
    await expect(readFile(ctx, { sessionId: 's-1', path: 'logo.png' })).resolves.toMatchObject({
      ok: false,
      code: 'bad-request',
    });
  });
});

describe('readFileBytes', () => {
  it('entrega bytes en base64 para una imagen', async () => {
    await expect(readFileBytes(ctx, { sessionId: 's-1', path: 'logo.png' })).resolves.toMatchObject(
      {
        ok: true,
        mime: 'image/png',
        data: Buffer.from([1, 2, 3]).toString('base64'),
      },
    );
  });

  it('no entrega bytes de un markdown', async () => {
    await expect(
      readFileBytes(ctx, { sessionId: 's-1', path: 'README.md' }),
    ).resolves.toMatchObject({ ok: false, code: 'bad-request' });
  });
});
