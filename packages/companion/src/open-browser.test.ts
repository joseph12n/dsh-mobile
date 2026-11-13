import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserOpener, openInBrowser } from './open-browser.js';

describe('abridor de navegador', () => {
  it('encuentra un ejecutable con ruta absoluta en esta plataforma', () => {
    const opener = browserOpener();
    if (opener) {
      expect(opener.startsWith('/') || /^[A-Za-z]:\\/.test(opener)).toBe(true);
    }
  });

  it('solo devuelve rutas absolutas', () => {
    const opener = browserOpener();
    if (opener) expect(isAbsolute(opener)).toBe(true);
  });

  it('sin abridor no intenta nada y responde false', async () => {
    await expect(openInBrowser('https://ejemplo', '')).resolves.toBe(false);
  });
});
