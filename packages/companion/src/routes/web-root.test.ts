import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findWebRoot } from './web-root.js';

/**
 * Localización de la PWA compilada.
 *
 * Esta prueba existe por un fallo real: `web-root.js` vive en `dist/routes/`, y
 * el cálculo de la ruta subía un nivel de menos. El servidor no encontraba la
 * PWA y `/` devolvía 404 en el teléfono, aunque la app estuviera compilada.
 *
 * Se prueba con un árbol de directorios de verdad, no con cadenas.
 */

const original = process.env.DSH_MOBILE_WEB_ROOT;

afterEach(() => {
  if (original === undefined) delete process.env.DSH_MOBILE_WEB_ROOT;
  else process.env.DSH_MOBILE_WEB_ROOT = original;
});

/** Monta un fake de repositorio y devuelve el `moduleUrl` del módulo dentro de él. */
function scaffold(options: { embedded?: boolean; monorepo?: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-web-root-'));
  const plugin = join(root, 'packages', 'companion');
  const routes = join(plugin, 'dist', 'routes');
  mkdirSync(routes, { recursive: true });

  const modulePath = join(routes, 'web-root.js');
  writeFileSync(modulePath, '// fake');

  // Disposición publicada: la PWA viaja dentro del paquete del plugin.
  if (options.embedded) {
    const web = join(plugin, 'dist', 'web');
    mkdirSync(web, { recursive: true });
    writeFileSync(join(web, 'index.html'), '<!doctype html>');
  }

  // Disposición de monorepo: la PWA se compila en su propio paquete.
  if (options.monorepo) {
    const app = join(root, 'packages', 'app', 'dist');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'index.html'), '<!doctype html>');
  }

  return pathToFileURL(modulePath).href;
}

describe('localización de la PWA', () => {
  it('encuentra la PWA publicada dentro del paquete', () => {
    const moduleUrl = scaffold({ embedded: true });
    const found = findWebRoot(moduleUrl);

    expect(found).toBeDefined();
    expect(found?.replaceAll('\\', '/')).toMatch(/packages\/companion\/dist\/web$/);
  });

  it('encuentra la PWA del monorepo', () => {
    const moduleUrl = scaffold({ monorepo: true });
    const found = findWebRoot(moduleUrl);

    expect(found).toBeDefined();
    expect(found?.replaceAll('\\', '/')).toMatch(/packages\/app\/dist$/);
  });

  it('prefiere la copia publicada sobre la del monorepo', () => {
    const moduleUrl = scaffold({ embedded: true, monorepo: true });
    expect(findWebRoot(moduleUrl)?.replaceAll('\\', '/')).toMatch(/companion\/dist\/web$/);
  });

  it('la variable de entorno manda sobre todo', () => {
    const moduleUrl = scaffold({ embedded: true, monorepo: true });
    const custom = mkdtempSync(join(tmpdir(), 'dsh-web-custom-'));
    writeFileSync(join(custom, 'index.html'), '<!doctype html>');

    process.env.DSH_MOBILE_WEB_ROOT = custom;
    expect(findWebRoot(moduleUrl)).toBe(custom);
  });

  it('ignora una variable de entorno que no contiene la PWA', () => {
    const moduleUrl = scaffold({ monorepo: true });
    process.env.DSH_MOBILE_WEB_ROOT = join(tmpdir(), 'no-existe-dsh-mobile');

    expect(findWebRoot(moduleUrl)?.replaceAll('\\', '/')).toMatch(/packages\/app\/dist$/);
  });

  it('devuelve undefined si no hay PWA en ningún sitio', () => {
    expect(findWebRoot(scaffold({}))).toBeUndefined();
  });

  it('encuentra la PWA de este repositorio con la ruta real del módulo', () => {
    // Sin inyectar `moduleUrl`: comprueba la disposición verdadera. Si la PWA no
    // está compilada se omite, porque aquí no hay nada que verificar.
    const found = findWebRoot();
    if (found === undefined) return;
    expect(found.replaceAll('\\', '/')).toMatch(/packages\/app\/dist$/);
  });
});
