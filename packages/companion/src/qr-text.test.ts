import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { qrText } from './qr-text.js';

/**
 * The text QR.
 *
 * It is opt-in (`/mobile qr`) because a text QR only scans when line height equals
 * font size, which the DSH chat does not do. In a plain terminal it does scan, and
 * that is what this renders.
 *
 * Decoding was verified by hand with two independent readers (JSQR and ZXing) from
 * a browser screenshot. These tests pin the structure, which a decoder needs:
 * uniform width, quiet zone on both sides, and no escape sequences.
 */

const URL = 'https://maquina.tailnet.ts.net/#/pair?v=1&c=ABCD1234EFGH5678';

/** Data lines only: the matrix, without the metadata footer. */
function dataLines(text: string): string[] {
  return text.split('\n').filter((line) => !line.startsWith('(v'));
}

describe('text QR', () => {
  it('draws the same matrix as the library', () => {
    // The library renders it too, but asynchronously, and the command handler is
    // synchronous. Comparing the dark modules proves the reimplementation is exact.
    const mine = dataLines(qrText(URL));

    const theirMatrix = QRCode.create(URL, { errorCorrectionLevel: 'M' });
    const size = theirMatrix.modules.size;
    const get = (row: number, column: number): boolean => {
      if (row < 0 || row >= size || column < 0 || column >= size) return false;
      return theirMatrix.modules.get(row, column) === 1;
    };

    // Rebuild the expected half-block rows straight from the library matrix.
    const expected: string[] = [];
    for (let row = -2; row < size + 2; row += 2) {
      let line = '';
      for (let column = -2; column < size + 2; column += 1) {
        const top = get(row, column);
        const bottom = get(row + 1, column);
        line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
      }
      expected.push(line);
    }

    expect(mine).toEqual(expected);
  });

  it('every line is the same width, quiet zone included', () => {
    // A QR needs its margin on all four sides. Trimming the right side removed
    // part of it, and readers failed to find the code.
    const lines = dataLines(qrText(URL));
    const widths = new Set(lines.map((line) => line.length));
    expect(widths.size).toBe(1);

    // The quiet zone must be there, on both sides of a middle row.
    const middle = lines[Math.floor(lines.length / 2)] ?? '';
    expect(middle.startsWith(' ')).toBe(true);
    expect(middle.endsWith(' ')).toBe(true);
  });

  it('uses half blocks and no escape sequences', () => {
    const text = qrText(URL);
    expect(text).toMatch(/[▀▄█]/);
    // ANSI would break the drawing in any chat: check the character itself.
    expect(text.includes(String.fromCharCode(27))).toBe(false);
  });

  it('different links produce different codes', () => {
    expect(qrText(URL)).not.toBe(qrText(`${URL}9`));
  });

  it('a longer text needs more lines', () => {
    const short = dataLines(qrText('hi')).length;
    const long = dataLines(qrText(`${URL}?pad=${'x'.repeat(200)}`)).length;
    expect(long).toBeGreaterThan(short);
  });
});
