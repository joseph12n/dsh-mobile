import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { qrText } from './qr-text.js';

/**
 * El QR en texto es lo único que hace que emparejar no sea copiar 26 caracteres
 * a mano. Si se pinta mal, no se lee, y el comando vuelve a ser inútil.
 */

const URL = 'https://maquina.tailnet.ts.net/#/pair?v=1&c=ABCD1234EFGH5678';

describe('QR en texto', () => {
  it('coincide con el renderizador de la propia librería', async () => {
    // `qrcode` sabe pintarlo, pero devuelve una promesa y el handler del comando
    // es síncrono. Esto comprueba que el apaño síncrono no cambia el dibujo.
    const propio = qrText(URL)
      .split('\n')
      .filter((line) => line && !line.startsWith('(v'));

    const libreria = (
      await QRCode.toString(URL, { type: 'utf8', errorCorrectionLevel: 'M', margin: 2 })
    )
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    expect(propio).toEqual(libreria);
  });

  it('usa medias bloques y no secuencias de escape', () => {
    const text = qrText(URL);
    expect(text).toMatch(/[▀▄█]/);
    // Escapes ANSI romperían el dibujo en cualquier chat: se comprueba el carácter.
    expect(text.includes(String.fromCharCode(27))).toBe(false);
  });

  it('el dibujo ocupa el ancho que anuncia su cabecera', () => {
    // Sin recortar, todas las líneas miden lo mismo: módulos más el margen a los
    // dos lados. Es lo que garantiza que las columnas queden alineadas al
    // escanear, aunque se recorten los espacios finales.
    const partes = qrText(URL).split('\n');
    const cabecera = partes.find((line) => line.startsWith('(v'));
    const modulo = /\(v\d+, (\d+)×\d+ módulos\)/.exec(cabecera ?? '');
    expect(modulo).not.toBeNull();

    const ancho = Math.max(...partes.filter((l) => l && !l.startsWith('(v')).map((l) => l.length));
    const modulos = Number(modulo?.[1]);

    // Recortadas las líneas, el ancho queda entre el código solo y el código con
    // su margen a los dos lados. Fuera de ese rango, algo se pintó de más.
    expect(ancho).toBeGreaterThanOrEqual(modulos);
    expect(ancho).toBeLessThanOrEqual(modulos + 4);
  });

  it('dos enlaces distintos producen códigos distintos', () => {
    expect(qrText(URL)).not.toBe(qrText(`${URL}9`));
  });

  it('un texto corto cabe en menos líneas que uno largo', () => {
    const corto = qrText('hola').split('\n').length;
    const largo = qrText(`${URL}?relleno=${'x'.repeat(200)}`).split('\n').length;
    expect(largo).toBeGreaterThan(corto);
  });
});
