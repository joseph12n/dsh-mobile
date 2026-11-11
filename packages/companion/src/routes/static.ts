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
 * - **`/assets/`: inmutable un año.** Todo lo que Vite escribe ahí lleva hash de
 *   contenido en el nombre, así que un cambio de código produce otro nombre y la
 *   URL vieja nunca puede quedar obsoleta. Es la recomendación de Vite y lo que
 *   hace cualquier servidor estático con una carpeta de build.
 * - **Fuentes: un día.** Sus nombres son estables, sin hash; un año las dejaría
 *   pegadas para siempre si algún día cambian.
 * - **Todo lo demás, incluido `index.html`: revalidar siempre.** Si el índice se
 *   cacheara, una actualización del plugin dejaría al móvil con la versión vieja.
 *
 * Antes se intentaba adivinar mirando el nombre (`nombre-<hash>.ext`). Era frágil
 * por los dos lados: el hash de Vite puede llevar guiones (`index-B9xjfS-v.js`) y
 * un nombre en kebab-case se confundía con un hash (`arrow-down-circle.js`), así
 * que assets mutables se servían como inmutables. Además el barrido era cuadrático
 * con entradas adversarias, en una ruta pública.
 *
 * **Invariante que hay que respetar:** nada sin hash en `public/assets/`. Vite
 * copia esa carpeta tal cual, y un archivo estable ahí se quedaría cacheado un año.
 */
export function cacheControlFor(urlPath: string): string {
  const normalized = urlPath.split('?')[0]?.replace(/\\/g, '/') ?? '';

  if (normalized.startsWith('/assets/')) return 'public, max-age=31536000, immutable';

  if (normalized.startsWith('/fonts/') && FONT_FILE.test(normalized.slice(7))) {
    return 'public, max-age=86400';
  }

  return 'no-cache';
}

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
      // La política se decide por el **archivo servido**, no por la URL pedida.
      // Con la URL, el fallback de la SPA (`/assets/loquesea`, `/assets/../`) servía
      // `index.html` con caché inmutable de un año: justo la versión pegada que la
      // política dice evitar. Es el único sitio donde importa la diferencia.
      headers: headersFor(file, body.length, cacheControlFor(pathFor(file, root))),
    };
  } catch {
    return { status: 404 };
  }
}

/** Ruta relativa a la raíz, con la forma que espera `cacheControlFor`. */
function pathFor(file: string, root: string): string {
  const relative = file.slice(resolve(root).length).replace(/\\/g, '/');
  return relative.startsWith('/') ? relative : `/${relative}`;
}
