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
 * Política de caché.
 *
 * - Assets con hash en el nombre (los emite Vite): inmutables para siempre.
 * - Fuentes: nombres estables, sin hash. Un día de caché reduce la descarga
 *   repetida de ~120 KB sin arriesgar quedarse con una fuente vieja para siempre.
 * - Todo lo demás, incluido `index.html`: revalidar siempre, o una actualización
 *   del plugin dejaría al móvil con la versión anterior pegada.
 *
 * La comprobación evita un cuantificador anidado sobre la ruta completa —eso
 * produce retroceso superlineal— y trabaja solo sobre el nombre del archivo.
 */
export function cacheControlFor(urlPath: string): string {
  const normalized = urlPath.split('?')[0]?.replace(/\\/g, '/') ?? '';

  if (normalized.startsWith('/assets/')) {
    const name = normalized.slice(normalized.lastIndexOf('/') + 1);
    if (isHashedAsset(name)) return 'public, max-age=31536000, immutable';
  }

  if (normalized.startsWith('/fonts/') && FONT_FILE.test(normalized.slice(7))) {
    return 'public, max-age=86400';
  }

  return 'no-cache';
}

/**
 * `nombre-<hash>.ext`, que es como Vite nombra lo que puede cachearse.
 *
 * Se parte por el último guion en vez de usar una expresión con dos clases
 * solapadas (`[\w.-]+-[hash]`): esas dos pueden repartirse la misma cadena de
 * muchas formas y el retroceso crece muy por encima de lo lineal.
 */
function isHashedAsset(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;

  const stem = name.slice(0, dot);
  const extension = name.slice(dot + 1);
  const dash = stem.lastIndexOf('-');
  if (dash <= 0) return false;

  const hash = stem.slice(dash + 1);
  return HASH.test(hash) && EXTENSION.test(extension);
}

/** Sufijo con pinta de hash de Vite. */
const HASH = /^[A-Za-z0-9_-]{8,}$/;

/** Extensión alfanumérica corta. */
const EXTENSION = /^[a-z0-9]+$/i;

/** Una fuente dentro de `/fonts/`, sin subdirectorios. */
const FONT_FILE = /^[^/]+\.(woff2?|ttf)$/i;

function headersFor(file: string, size: number, cacheControl: string): Record<string, string> {
  return {
    'content-type': contentTypeFor(file),
    'content-length': String(size),
    'cache-control': cacheControl,
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
    return {
      status: 200,
      body,
      headers: headersFor(file, body.length, cacheControlFor(urlPath)),
    };
  } catch {
    return { status: 404 };
  }
}
