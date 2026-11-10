import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * Servido de la PWA desde el propio plugin.
 *
 * Un solo artefacto trae host y cliente, así que no pueden desincronizarse: la
 * versión del plugin y la de la PWA son la misma por construcción.
 *
 * El servidor no sabe nada de archivos: recibe una raíz y responde. Las pruebas
 * lo ejercitan con un directorio temporal.
 */

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

/**
 * Un recurso merece caché larga solo si Vite le puso hash en el nombre
 * (`index-a1b2c3.js`). Todo lo demás — el índice, el manifest, los iconos — debe
 * revalidarse, o una actualización del plugin dejaría al móvil con la versión
 * anterior pegada.
 *
 * Se decide sobre la **URL**, no sobre la ruta del archivo: en Windows esta
 * última lleva barras invertidas y nunca coincidiría.
 */
export function isImmutable(urlPath: string): boolean {
  const normalized = urlPath.split('?')[0]?.replace(/\\/g, '/') ?? '';
  return /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(normalized);
}

function headersFor(file: string, size: number, immutable: boolean): Record<string, string> {
  return {
    'content-type': contentTypeFor(file),
    'content-length': String(size),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  };
}

/**
 * Resuelve una ruta de la URL a un archivo dentro de `root`.
 *
 * Devuelve `index.html` para la raíz y para cualquier ruta sin extensión, porque
 * la app enruta por fragmento y no tiene rutas de servidor.
 *
 * Cualquier intento de salir de la raíz (`..`, rutas absolutas, enlaces
 * simbólicos resueltos) devuelve `undefined` en vez de leerse.
 */
export function resolveAsset(root: string, urlPath: string): string | undefined {
  const cleanRoot = resolve(root);

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    // Un porcentaje mal formado no es una ruta válida.
    return undefined;
  }

  // Neutraliza `..` antes de unir, y luego comprueba que no se escapó.
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative.includes('\0')) return undefined;

  let candidate = resolve(join(cleanRoot, relative || 'index.html'));

  if (candidate !== cleanRoot && !candidate.startsWith(cleanRoot + sep)) return undefined;

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    candidate = join(candidate, 'index.html');
  }

  // Sin extensión: es una ruta de la SPA, se sirve el índice.
  if (!extname(candidate) || !existsSync(candidate)) {
    const fallback = join(cleanRoot, 'index.html');
    return existsSync(fallback) ? fallback : undefined;
  }

  return candidate;
}

/** Respuesta para una ruta de la PWA. `status: 404` si no hay nada que servir. */
export function serveStatic(root: string | undefined, urlPath: string): StaticResult {
  if (!root) return { status: 404 };

  const file = resolveAsset(root, urlPath);
  if (!file) return { status: 404 };

  try {
    const body = readFileSync(file);
    return { status: 200, body, headers: headersFor(file, body.length, isImmutable(urlPath)) };
  } catch {
    return { status: 404 };
  }
}
