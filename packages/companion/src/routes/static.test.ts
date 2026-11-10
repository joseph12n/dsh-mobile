import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveAsset, serveStatic } from './static.js';

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

  it('no cachea un asset sin hash', () => {
    const result = serveStatic(root, '/assets/styles.css');
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
