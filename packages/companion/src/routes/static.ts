import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticResult {
  status: number;
  body?: Buffer;
  headers?: Record<string, string>;
}

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function cacheControlFor(urlPath: string): string {
  const normalized = urlPath.split('?')[0]?.replace(/\\/g, '/') ?? '';

  if (normalized.startsWith('/assets/')) return 'public, max-age=31536000, immutable';

  if (normalized.startsWith('/fonts/') && FONT_FILE.test(normalized.slice(7))) {
    return 'public, max-age=86400';
  }

  return 'no-cache';
}

const FONT_FILE = /^[^/]+\.(woff2?|ttf)$/i;

function headersFor(file: string, size: number, cacheControl: string): Record<string, string> {
  return {
    'content-type': contentTypeFor(file),
    'content-length': String(size),
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  };
}

export function resolveAsset(root: string, urlPath: string): string | undefined {
  const cleanRoot = resolve(root);
  const realRoot = realOrUndefined(cleanRoot);
  if (!realRoot) return undefined;

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return undefined;
  }

  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative.includes('\0')) return undefined;

  const candidate = resolve(join(cleanRoot, relative || 'index.html'));

  if (!isInside(cleanRoot, candidate)) return undefined;

  const realCandidate = realOrUndefined(candidate);
  if (realCandidate === undefined) return spaIndex(cleanRoot, realRoot);

  if (!isInside(realRoot, realCandidate)) return undefined;

  const stats = statOrUndefined(realCandidate);
  if (stats?.isDirectory()) {
    const index = join(candidate, 'index.html');
    const realIndex = realOrUndefined(index);
    return realIndex && isInside(realRoot, realIndex) && statOrUndefined(realIndex)?.isFile()
      ? index
      : spaIndex(cleanRoot, realRoot);
  }

  if (!stats?.isFile()) return undefined;

  if (!extname(candidate)) return spaIndex(cleanRoot, realRoot);
  return candidate;
}

function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

function statOrUndefined(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function withSep(path: string): string {
  return path.endsWith(sep) ? path : path + sep;
}

function isInside(realRoot: string, path: string): boolean {
  const [base, target] =
    process.platform === 'win32' ? [realRoot.toLowerCase(), path.toLowerCase()] : [realRoot, path];

  return target === base || target.startsWith(withSep(base));
}

function spaIndex(cleanRoot: string, realRoot: string): string | undefined {
  const index = join(cleanRoot, 'index.html');
  const realIndex = realOrUndefined(index);
  return realIndex && isInside(realRoot, realIndex) && statOrUndefined(realIndex)?.isFile()
    ? index
    : undefined;
}

export function serveStatic(root: string | undefined, urlPath: string): StaticResult {
  if (!root) return { status: 404 };

  const file = resolveAsset(root, urlPath);
  if (!file) return { status: 404 };

  try {
    const body = readFileSync(file);
    return {
      status: 200,
      body,
      headers: headersFor(file, body.length, cacheControlFor(pathFor(file, root))),
    };
  } catch {
    return { status: 404 };
  }
}

function pathFor(file: string, root: string): string {
  const relative = file.slice(resolve(root).length).replace(/\\/g, '/');
  return relative.startsWith('/') ? relative : `/${relative}`;
}
