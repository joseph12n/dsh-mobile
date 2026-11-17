import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { FileInfo, FileKind } from '@deepseekharness-mobile/protocol';
import {
  service,
  type HostContext,
  type OfficeToPdfService,
  type ProjectionsService,
  type SessionsService,
  type WorkspaceFileScope,
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
  const session = sessions?.get(sessionId);
  const cwd = session?.header?.cwd;
  if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd;

  const projections = service<ProjectionsService>(ctx, 'sessionProjections');
  if (!session || !projections) return undefined;

  try {
    const value = projections.snapshot(session).values['workingDirectory'];
    return typeof value === 'string' && isAbsolute(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

interface FileTarget {
  scope: WorkspaceFileScope;
  root: string;
}

function targetOf(ctx: HostContext, sessionId: string): FileTarget | undefined {
  const root = workspaceRoot(ctx, sessionId);
  if (!root) return undefined;
  return { scope: { sessionId, workspaceRoot: root }, root };
}

function callerSignal(): AbortSignal {
  return new AbortController().signal;
}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function hostFailure(cause: unknown): FileOutcome {
  switch (errorCode(cause)) {
    case 'workspace-file/outside-workspace':
      return failure('bad-request', 'The file is outside the session workspace.');
    case 'workspace-file/not-regular-file':
      return failure('bad-request', 'The path is not a regular file.');
    case 'workspace-file/too-large':
      return failure('bad-request', 'The file is too large to preview.');
    case 'workspace-file/not-text':
      return failure('bad-request', 'That file is not text.');
    default:
      return failure('not-found', 'The file could not be read.');
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
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extension)) return 'office';
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
  const target = targetOf(ctx, input.sessionId);
  if (!workspaceFiles || !target) return failure('bad-request', 'Files are not available here.');

  const confined = within(target.root, input.path);
  if ('error' in confined) return failure('bad-request', confined.error);

  const displayPath = relative(target.root, confined.absolute) || confined.absolute;
  try {
    const stat = await workspaceFiles.stat(target.scope, confined.absolute, callerSignal());
    const kind = kindOf(confined.absolute);
    return { ok: true, file: infoOf(displayPath, stat, kind) };
  } catch (cause) {
    return hostFailure(cause);
  }
}

export async function readFile(
  ctx: HostContext,
  input: { sessionId: string; path: string; offset?: number },
): Promise<FileTextOutcome> {
  const workspaceFiles = files(ctx);
  const target = targetOf(ctx, input.sessionId);
  if (!workspaceFiles || !target) return failure('bad-request', 'Files are not available here.');

  const confined = within(target.root, input.path);
  if ('error' in confined) return failure('bad-request', confined.error);

  const displayPath = relative(target.root, confined.absolute) || confined.absolute;
  const kind = kindOf(confined.absolute);
  if (kind !== 'text' && kind !== 'markdown') {
    return failure('bad-request', 'That file is not text.');
  }

  try {
    const stat = await workspaceFiles.stat(target.scope, confined.absolute, callerSignal());
    if (typeof stat.bytes === 'number' && stat.bytes > MAX_TEXT_BYTES) {
      return failure('bad-request', 'The file is too large to preview.');
    }

    const page = await workspaceFiles.read(
      target.scope,
      confined.absolute,
      {
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
        limit: PAGE_LIMIT,
      },
      callerSignal(),
    );

    return {
      ok: true,
      file: infoOf(displayPath, page, kind),
      text: page.text,
      offset: page.offset,
      eof: page.eof,
      ...(page.eof ? {} : { nextOffset: page.offset + page.lines }),
    };
  } catch (cause) {
    return hostFailure(cause);
  }
}

export async function readFileBytes(
  ctx: HostContext,
  input: { sessionId: string; path: string },
): Promise<FileBytesOutcome> {
  const workspaceFiles = files(ctx);
  const target = targetOf(ctx, input.sessionId);
  if (!workspaceFiles || !target) return failure('bad-request', 'Files are not available here.');

  const confined = within(target.root, input.path);
  if ('error' in confined) return failure('bad-request', confined.error);

  const displayPath = relative(target.root, confined.absolute) || confined.absolute;
  const kind = kindOf(confined.absolute);

  if (kind === 'office') {
    return officeBytes(ctx, target, displayPath, confined.absolute);
  }

  if (kind !== 'image' && kind !== 'pdf') {
    return failure('bad-request', 'That file cannot be shown as bytes.');
  }

  try {
    const stat = await workspaceFiles.stat(target.scope, confined.absolute, callerSignal());
    if (typeof stat.bytes === 'number' && stat.bytes > MAX_BYTES) {
      return failure('bad-request', 'The file is too large to preview.');
    }

    const bytes = await workspaceFiles.readBytes(
      target.scope,
      confined.absolute,
      {},
      callerSignal(),
    );
    if (bytes.data.byteLength > MAX_BYTES) {
      return failure('bad-request', 'The file is too large to preview.');
    }

    return {
      ok: true,
      file: infoOf(displayPath, bytes, kind),
      mime: mimeOf(confined.absolute, kind),
      data: Buffer.from(bytes.data).toString('base64'),
    };
  } catch (cause) {
    return hostFailure(cause);
  }
}

async function officeBytes(
  ctx: HostContext,
  target: FileTarget,
  displayPath: string,
  absolutePath: string,
): Promise<FileBytesOutcome> {
  const office = service<OfficeToPdfService>(ctx, 'officeToPdf');
  const sessions = service<SessionsService>(ctx, 'sessions');
  const session = sessions?.get(target.scope.sessionId);
  if (!office || typeof office.render !== 'function' || !session) {
    return failure('bad-request', 'Office documents are not supported here.');
  }

  try {
    const result = await office.render(target.scope, absolutePath, 'foreground', callerSignal());
    if (result.data.byteLength > MAX_BYTES) {
      return failure('bad-request', 'The converted PDF is too large.');
    }

    return {
      ok: true,
      file: {
        path: displayPath,
        name: absolutePath.slice(
          Math.max(absolutePath.lastIndexOf('/'), absolutePath.lastIndexOf('\\')) + 1,
        ),
        kind: 'office',
        ...(result.data.byteLength > 0 ? { size: result.data.byteLength } : {}),
      },
      mime: 'application/pdf',
      data: Buffer.from(result.data).toString('base64'),
    };
  } catch {
    return failure('internal', 'The document could not be converted.');
  }
}
