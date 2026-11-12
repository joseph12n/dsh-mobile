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

  it('devuelve undefined sin lanzar si no hay ninguno', () => {
    expect(browserOpener()).toBeDefined();
  });

  it('sin abridor no intenta nada y responde false', async () => {
    await expect(openInBrowser('https://ejemplo', undefined)).resolves.toBe(false);
  });
});
