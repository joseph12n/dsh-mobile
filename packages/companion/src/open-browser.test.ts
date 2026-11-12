import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserOpener, openInBrowser } from './open-browser.js';

/**
 * Abrir el navegador es la red de seguridad del QR en texto. Lo importante es que
 * nunca lance y que no dependa de `PATH`.
 */

describe('abridor de navegador', () => {
  it('encuentra un ejecutable con ruta absoluta en esta plataforma', () => {
    const opener = browserOpener();
    if (opener) {
      expect(opener.startsWith('/') || /^[A-Za-z]:\\/.test(opener)).toBe(true);
    }
  });

  it('solo devuelve rutas absolutas', () => {
    // Una ruta relativa lanzaría lo que hubiera en el directorio actual, que es
    // justo lo que se evita al no usar PATH.
    const opener = browserOpener();
    if (opener) expect(isAbsolute(opener)).toBe(true);
  });

  it('sin abridor no intenta nada y responde false', async () => {
    // Cadena vacía, no `undefined`: pasar `undefined` activa el valor por defecto.
    await expect(openInBrowser('https://ejemplo', '')).resolves.toBe(false);
  });
});
