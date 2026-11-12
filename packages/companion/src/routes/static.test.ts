import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cacheControlFor, resolveAsset, serveStatic } from './static.js';

/**
 * El servido de la PWA. Lo que importa aquí no es que sirva archivos, sino que
 * **no sirva archivos de fuera de su raíz**.
 */

const root = mkdtempSync(join(tmpdir(), 'dsh-mobile-web-'));

writeFileSync(join(root, 'index.html'), '<!doctype html><title>DSH Mobile</title>');
writeFileSync(join(root, 'manifest.webmanifest'), '{"name":"DSH Mobile"}');
mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'assets', 'index-a1b2c3d4.js'), 'console.log(1)');
writeFileSync(join(root, 'assets', 'styles.css'), 'body{margin:0}');

// Un archivo fuera de la raíz, para intentar escapar.
const outside = mkdtempSync(join(tmpdir(), 'dsh-mobile-outside-'));
writeFileSync(join(outside, 'secreto.txt'), 'no deberías poder leer esto');

afterAll(() => {
  // Los temporales del sistema se limpian solos; no hace falta borrar.
});

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
    // Puede devolver el índice (comportamiento de SPA) o indefinido, pero jamás
    // un archivo de fuera: eso es lo que se está protegiendo.
    for (const attempt of [
      '/../../../etc/passwd',
      '/..%2f..%2fsecreto.txt',
      '/assets/../../../secreto.txt',
    ]) {
      const resolved = resolveAsset(root, attempt);
      expect(resolved === undefined || resolved.startsWith(root)).toBe(true);
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
      const resolved = resolveAsset(root, attempt);
      expect(resolved === undefined || resolved.startsWith(root)).toBe(true);
    }
  });
});

describe('enlaces simbólicos', () => {
  // Una junction dentro de la raíz que apunta fuera. Es el vector real: la ruta pedida
  // está dentro, y el archivo que se leería no.
  let linked = false;
  try {
    symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
  } catch {
    // Crear enlaces requiere permisos en algunos sistemas; entonces no se prueba.
  }

  it('no sigue un enlace que sale de la raíz', (context) => {
    if (!linked) context.skip();

    // Se comprueba lo que de verdad importa: que no se sirve el secreto.
    const result = serveStatic(root, '/escape/secreto.txt');
    expect(result.status).toBe(404);
    expect(result.body?.toString() ?? '').not.toContain('no deberías poder leer esto');
  });

  it('no devuelve una ruta de fuera a través del enlace', (context) => {
    if (!linked) context.skip();
    expect(resolveAsset(root, '/escape/secreto.txt')).toBeUndefined();
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
    // La política ya no adivina por el nombre: la carpeta decide.
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
    // Sin hash en el nombre, immutables sería arriesgado: cambiar la fuente
    // dejaría al móvil con la vieja para siempre.
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
    // La carpeta la genera Vite: cada archivo lleva hash de contenido, así que la
    // URL cambia cuando cambia el contenido.
    expect(cacheControlFor('/assets/index-B9xjfS-v.js')).toContain('immutable');
    expect(cacheControlFor('/assets/index-CF_NO8rz.js')).toContain('immutable');
    expect(cacheControlFor('/assets/index-BdfqLpJ5.css')).toContain('immutable');
  });

  it('no intenta adivinar por el nombre: el kebab-case también es inmutable', () => {
    // Antes se confundía `arrow-down-circle.js` con un asset con hash y se
    // servía un año; y un asset hasheado con guiones se quedaba sin caché. Ya no
    // se mira el nombre.
    expect(cacheControlFor('/assets/arrow-down-circle.js')).toContain('immutable');
    expect(cacheControlFor('/assets/my-component-name.js')).toContain('immutable');
  });

  it('la consulta no cambia la decisión', () => {
    expect(cacheControlFor('/assets/index-B9xjfS-v.js?v=2')).toContain('immutable');
  });

  it('es constante aunque la ruta sea enorme', () => {
    // Antes el barrido por guiones era cuadrático: una ruta de 16 KB tardaba
    // cientos de milisegundos por petición, en una ruta pública.
    const hostil = '/assets/' + 'a-'.repeat(8000) + '!.js';
    const started = performance.now();
    expect(cacheControlFor(hostil)).toContain('immutable');
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('el fallback de la SPA no se cachea como un asset', () => {
  it('una ruta inexistente bajo /assets/ sirve el índice y revalida', () => {
    // Antes se decidía por la URL: `/assets/loquesea` recibía el índice con caché
    // inmutable de un año. Es justo la versión pegada que la política evita.
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
