/**
 * Renders a QR code as text, so the `/mobile qr` command can print it.
 *
 * Why this is not the default path: **a text QR only scans when the line height
 * equals the font size**. Measured in the DeepSeek Harness chat, code blocks use
 * 11px text over 19px lines, which leaves horizontal gaps between module rows and
 * breaks the code for both JSQR and ZXing. Printing it there looks like it works
 * and does not, so the command opens the pairing page instead, where the QR is a
 * real image.
 *
 * In a plain terminal — where line height usually is 1 — it does scan, and that is
 * what `qrcode`'s own `type: 'utf8'` produces too.
 *
 * `qrcode` can render it directly, but returns a promise and the command handler is
 * synchronous. `QRCode.create` is synchronous and gives the matrix, so the drawing
 * happens here.
 */
import QRCode from 'qrcode';

/** Modules of margin around the code. The standard asks for 4; 2 keeps it small. */
const QUIET_ZONE = 2;

interface ModuleMatrix {
  size: number;
  get(row: number, column: number): number;
}

/** `1` if the module is dark; `0` outside the matrix. */
function bit(matrix: ModuleMatrix, row: number, column: number): number {
  if (row < 0 || row >= matrix.size || column < 0 || column >= matrix.size) return 0;
  return matrix.get(row, column);
}

/**
 * Draws the matrix with `▀`, `▄`, `█` and space.
 *
 * Each character covers two module rows: the top half and the bottom half, so the
 * output has half as many lines as the code has rows.
 *
 * Lines are **padded** to the full width. Trimming them removed the right quiet
 * zone, and a QR needs its margin on all four sides to be found by a reader.
 */
export function qrText(text: string, quietZone: number = QUIET_ZONE): string {
  const { modules, version } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const matrix = modules as unknown as ModuleMatrix;
  const total = matrix.size + quietZone * 2;

  const lines: string[] = [];

  for (let row = -quietZone; row < total - quietZone; row += 2) {
    let line = '';

    for (let column = -quietZone; column < total - quietZone; column += 1) {
      const top = bit(matrix, row, column) === 1;
      const bottom = bit(matrix, row + 1, column) === 1;

      if (top && bottom) line += '█';
      else if (top) line += '▀';
      else if (bottom) line += '▄';
      else line += ' ';
    }

    lines.push(line);
  }

  return `${lines.join('\n')}\n(v${version}, ${matrix.size}×${matrix.size} modules)`;
}
