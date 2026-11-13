import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cacheControlFor, resolveAsset, serveStatic } from './static.js';

const root = mkdtempSync(join(tmpdir(), 'dsh-mobile-web-'));

writeFileSync(join(root, 'index.html'), '<!doctype html><title>DSH Mobile</title>');
writeFileSync(join(root, 'manifest.webmanifest'), '{"name":"DSH Mobile"}');
mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'assets', 'index-a1b2c3d4.js'), 'console.log(1)');
writeFileSync(join(root, 'assets', 'styles.css'), 'body{margin:0}');

const outside = mkdtempSync(join(tmpdir(), 'dsh-mobile-outside-'));
writeFileSync(join(outside, 'secreto.txt'), 'no deberías poder leer esto');

afterAll(() => {});

describe('resolución de rutas', () => {
  it('sirve el índice en la raíz', () => {
    expect(resolveAsset(root, '/')).toBe(join(root, 'index.html'));
  });

  it('sirve un asset real', () => {
    expect(resolveAsset(root, '/assets/index-a1b2c3d4.js')).toBe(
      join(root, 'assets', 'index-a1b2c3d4.js'),
    );
  });

  it('cae al índice en una ruta de la SPA', () => {
    expect(resolveAsset(root, '/sesiones/abc')).toBe(join(root, 'index.html'));
  });

  it('ignora la query y decodifica el porcentaje', () => {
    expect(resolveAsset(root, '/assets/styles.css?v=2')).toBe(join(root, 'assets', 'styles.css'));
  });

  it('nunca sale de la raíz con ..', () => {
    for (const attempt of [
      '/../../../etc/passwd',
      '/..%2f..%2fsecreto.txt',
      '/assets/../../../secreto.txt',
    ]) {
      expect(insideRoot(resolveAsset(root, attempt))).toBe(true);
    }
  });

  it('rechaza una ruta absoluta', () => {
    expect(resolveAsset(root, '/C:/Windows/win.ini')).not.toBe(join('C:', 'Windows', 'win.ini'));
  });

  it('rechaza un porcentaje mal formado', () => {
    expect(resolveAsset(root, '/%zz')).toBeUndefined();
  });

  it('nunca devuelve un archivo de fuera de la raíz', () => {
    const outsideFile = join(outside, 'secreto.txt');
    for (const attempt of ['/../secreto.txt', outsideFile, `/..${outsideFile}`]) {
      expect(insideRoot(resolveAsset(root, attempt))).toBe(true);
    }
  });
});

function insideRoot(resolved: string | undefined): boolean {
  if (resolved === undefined) return true;
  const base = resolve(root);
  return resolved === base || resolved.startsWith(base.endsWith(sep) ? base : base + sep);
}

describe('enlaces simbólicos', () => {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';

  let linked = false;
  try {
    symlinkSync(outside, join(root, 'escape'), linkType);
    linked = true;
  } catch {}

  const sibling = `${resolve(root)}-evil`;
  let siblingLinked = false;
  try {
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'vecino.txt'), 'no deberías poder leer esto');
    symlinkSync(sibling, join(root, 'vecino'), linkType);
    siblingLinked = true;
  } catch {}

  let insideLinked = false;
  try {
    symlinkSync(join(root, 'assets'), join(root, 'assets-enlazados'), linkType);
    insideLinked = true;
  } catch {}

  it('no sigue un enlace que sale de la raíz', (context) => {
    if (!linked) context.skip();

    const result = serveStatic(root, '/escape/secreto.txt');
    expect(result.status).toBe(404);
    expect(result.body?.toString() ?? '').not.toContain('no deberías poder leer esto');
  });

  it('no devuelve una ruta de fuera a través del enlace', (context) => {
    if (!linked) context.skip();
    expect(resolveAsset(root, '/escape/secreto.txt')).toBeUndefined();
  });

  it('tampoco sirve el índice a través de una carpeta enlazada fuera', (context) => {
    if (!linked) context.skip();
    expect(serveStatic(root, '/escape').status).toBe(404);
  });

  it('no confunde un hermano que empieza igual que la raíz', (context) => {
    if (!siblingLinked) context.skip();
    expect(serveStatic(root, '/vecino/vecino.txt').status).toBe(404);
  });

  it('sigue sirviendo un enlace que apunta dentro de la raíz', (context) => {
    if (!insideLinked) context.skip();
    const result = serveStatic(root, '/assets-enlazados/styles.css');
    expect(result.status).toBe(200);
    expect(result.body?.toString()).toBe('body{margin:0}');
  });
});

describe('respuestas', () => {
  it('devuelve 404 sin raíz', () => {
    expect(serveStatic(undefined, '/')).toEqual({ status: 404 });
  });

  it('sirve el índice con tipo de contenido correcto', () => {
    const result = serveStatic(root, '/');
    expect(result.status).toBe(200);
    expect(result.headers?.['content-type']).toBe('text/html; charset=utf-8');
    expect(result.headers?.['cache-control']).toBe('no-cache');
  });

  it('cachea para siempre un asset con hash en el nombre', () => {
    const result = serveStatic(root, '/assets/index-a1b2c3d4.js');
    expect(result.headers?.['cache-control']).toContain('immutable');
  });

  it('no cachea un archivo que no está en /assets/', () => {
    const result = serveStatic(root, '/styles.css');
    expect(result.headers?.['cache-control']).toBe('no-cache');
  });

  it('declara el manifest como manifest+json', () => {
    const result = serveStatic(root, '/manifest.webmanifest');
    expect(result.headers?.['content-type']).toContain('application/manifest+json');
  });

  it('devuelve 404 si no hay índice', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-mobile-empty-'));
    expect(serveStatic(empty, '/').status).toBe(404);
  });
});

describe('política de caché', () => {
  it('los assets con hash son inmutables', () => {
    expect(cacheControlFor('/assets/index-a1b2c3d4.js')).toContain('immutable');
  });

  it('las fuentes se cachean un día, sin immutable', () => {
    const value = cacheControlFor('/fonts/montserrat-regular.woff2');
    expect(value).toBe('public, max-age=86400');
    expect(value).not.toContain('immutable');
  });

  it('el índice y el manifest siempre revalidan', () => {
    expect(cacheControlFor('/')).toBe('no-cache');
    expect(cacheControlFor('/manifest.webmanifest')).toBe('no-cache');
    expect(cacheControlFor('/icon-192.png')).toBe('no-cache');
  });

  it('una fuente fuera de /fonts/ no recibe la caché de fuentes', () => {
    expect(cacheControlFor('/montserrat.woff2')).toBe('no-cache');
  });
});

describe('assets del build', () => {
  it('todo lo de /assets/ es inmutable', () => {
    expect(cacheControlFor('/assets/index-B9xjfS-v.js')).toContain('immutable');
    expect(cacheControlFor('/assets/index-CF_NO8rz.js')).toContain('immutable');
    expect(cacheControlFor('/assets/index-BdfqLpJ5.css')).toContain('immutable');
  });

  it('no intenta adivinar por el nombre: el kebab-case también es inmutable', () => {
    expect(cacheControlFor('/assets/arrow-down-circle.js')).toContain('immutable');
    expect(cacheControlFor('/assets/my-component-name.js')).toContain('immutable');
  });

  it('la consulta no cambia la decisión', () => {
    expect(cacheControlFor('/assets/index-B9xjfS-v.js?v=2')).toContain('immutable');
  });

  it('es constante aunque la ruta sea enorme', () => {
    const hostil = '/assets/' + 'a-'.repeat(8000) + '!.js';
    const started = performance.now();
    expect(cacheControlFor(hostil)).toContain('immutable');
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('el fallback de la SPA no se cachea como un asset', () => {
  it('una ruta inexistente bajo /assets/ sirve el índice y revalida', () => {
    const result = serveStatic(root, '/assets/no-existe.js');
    expect(result.status).toBe(200);
    expect(result.headers?.['cache-control']).toBe('no-cache');
  });

  it('un intento de salir de /assets/ tampoco se cachea', () => {
    for (const urlPath of ['/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/']) {
      const result = serveStatic(root, urlPath);
      expect(result.headers?.['cache-control']).toBe('no-cache');
    }
  });

  it('un asset que sí existe conserva la caché inmutable', () => {
    const result = serveStatic(root, '/assets/index-a1b2c3d4.js');
    expect(result.headers?.['cache-control']).toContain('immutable');
  });
});
