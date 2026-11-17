import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FileInfo, FileKind } from '@deepseekharness-mobile/protocol';
import {
  service,
  type HostContext,
  type ProjectionsService,
  type SessionsService,
  type WorkspaceFileStat,
  type WorkspaceFilesService,
} from '../host-api.js';

const MAX_TEXT_BYTES = 1_048_576;
const MAX_BYTES = 5_242_880;
const PAGE_LIMIT = 2_000;

export interface FileOutcome {
  ok: boolean;
  code?: 'bad-request' | 'not-found' | 'internal';
  message?: string;
  file?: FileInfo;
}

export interface FileTextOutcome extends FileOutcome {
  text?: string;
  offset?: number;
  eof?: boolean;
  nextOffset?: number;
}

export interface FileBytesOutcome extends FileOutcome {
  mime?: string;
  data?: string;
}

function files(ctx: HostContext): WorkspaceFilesService | undefined {
  return service<WorkspaceFilesService>(ctx, 'workspaceFiles');
}

export function filesAvailable(ctx: HostContext): boolean {
  const workspaceFiles = files(ctx);
  return (
    typeof workspaceFiles?.read === 'function' &&
    typeof workspaceFiles?.stat === 'function' &&
    typeof workspaceFiles?.readBytes === 'function'
  );
}

function workspaceRoot(ctx: HostContext, sessionId: string): string | undefined {
  const sessions = service<SessionsService>(ctx, 'sessions');
  const projections = service<ProjectionsService>(ctx, 'sessionProjections');
  const session = sessions?.get(sessionId);
  if (!session || !projections) return undefined;

  try {
    const value = projections.snapshot(session).values['workingDirectory'];
    return typeof value === 'string' && isAbsolute(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function within(root: string, requested: string): { absolute: string } | { error: string } {
  if (requested.includes('\0') || requested.startsWith('http:') || requested.startsWith('https:')) {
    return { error: 'The path is not a workspace file.' };
  }

  const absolute = resolve(root, requested);
  if (absolute !== root && !absolute.startsWith(root.endsWith(sep) ? root : root + sep)) {
    return { error: 'The file is outside the session workspace.' };
  }

  return { absolute };
}

function kindOf(path: string): FileKind {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(extension)) return 'image';
  if (
    [
      '.txt',
      '.log',
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.css',
      '.html',
      '.sh',
      '.ps1',
      '.py',
      '.rs',
      '.go',
      '.sql',
      '.csv',
    ].includes(extension)
  )
    return 'text';
  return 'other';
}

function mimeOf(path: string, kind: FileKind): string {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (kind === 'markdown') return 'text/markdown';
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'image') {
    if (extension === '.png') return 'image/png';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.avif') return 'image/avif';
    return 'image/jpeg';
  }
  return 'text/plain';
}

function infoOf(path: string, stat: WorkspaceFileStat, kind: FileKind): FileInfo {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path;
  return {
    path,
    name,
    kind,
    ...(typeof stat.bytes === 'number' ? { size: stat.bytes } : {}),
  };
}

function failure(status: 'bad-request' | 'not-found' | 'internal', message: string): FileOutcome {
  return { ok: false, code: status, message };
}

export async function statFile(
  ctx: HostContext,
  input: { sessionId: string; path: string },
): Promise<FileOutcome> {
  const workspaceFiles = files(ctx);
  const root = workspaceRoot(ctx, input.sessionId);
  if (!workspaceFiles || !root) return failure('bad-request', 'Files are not available here.');

  const confined = within(root, input.path);
  if ('error' in confined) return failure('bad-request', confined.error);

  const relativePath = relative(root, confined.absolute);
  try {
    const stat = await workspaceFiles.stat(input.sessionId, relativePath);
    const kind = kindOf(confined.absolute);
    return { ok: true, file: infoOf(relativePath, stat, kind) };
  } catch {
    return failure('not-found', 'The file could not be read.');
  }
}

export async function readFile(
  ctx: HostContext,
  input: { sessionId: string; path: string; offset?: number },
): Promise<FileTextOutcome> {
  const workspaceFiles = files(ctx);
  const root = workspaceRoot(ctx, input.sessionId);
  if (!workspaceFiles || !root) return failure('bad-request', 'Files are not available here.');

  const confined = within(root, input.path);
  if ('error' in confined) return failure('bad-request', confined.error);

  const relativePath = relative(root, confined.absolute);
  const kind = kindOf(confined.absolute);
  if (kind !== 'text' && kind !== 'markdown') {
    return failure('bad-request', 'That file is not text.');
  }

  try {
    const stat = await workspaceFiles.stat(input.sessionId, relativePath);
    if (typeof stat.bytes === 'number' && stat.bytes > MAX_TEXT_BYTES) {
      return failure('bad-request', 'The file is too large to preview.');
    }

    const page = await workspaceFiles.read(input.sessionId, relativePath, {
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      limit: PAGE_LIMIT,
    });

    return {
      ok: true,
      file: infoOf(relativePath, page, kind),
      text: page.text,
      offset: page.offset,
      eof: page.eof,
      ...(page.eof ? {} : { nextOffset: page.offset + page.lines }),
    };
  } catch {
    return failure('not-found', 'The file could not be read.');
  }
}

export async function readFileBytes(
  ctx: HostContext,
  input: { sessionId: string; path: string },
): Promise<FileBytesOutcome> {
  const workspaceFiles = files(ctx);
  const root = workspaceRoot(ctx, input.sessionId);
  if (!workspaceFiles || !root) return failure('bad-request', 'Files are not available here.');

  const confined = within(root, input.path);
  if ('error' in confined) return failure('bad-request', confined.error);

  const relativePath = relative(root, confined.absolute);
  const kind = kindOf(confined.absolute);
  if (kind !== 'image' && kind !== 'pdf') {
    return failure('bad-request', 'That file cannot be shown as bytes.');
  }

  try {
    const stat = await workspaceFiles.stat(input.sessionId, relativePath);
    if (typeof stat.bytes === 'number' && stat.bytes > MAX_BYTES) {
      return failure('bad-request', 'The file is too large to preview.');
    }

    const bytes = await workspaceFiles.readBytes(input.sessionId, relativePath);
    if (bytes.data.byteLength > MAX_BYTES) {
      return failure('bad-request', 'The file is too large to preview.');
    }

    return {
      ok: true,
      file: infoOf(relativePath, bytes, kind),
      mime: mimeOf(confined.absolute, kind),
      data: Buffer.from(bytes.data).toString('base64'),
    };
  } catch {
    return failure('not-found', 'The file could not be read.');
  }
}
