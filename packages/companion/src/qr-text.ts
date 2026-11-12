/**
 * QR en texto, para que el comando `/mobile` lo pueda pintar en el chat.
 *
 * El comando antes daba un enlace y un código para copiar a mano, y nadie va a
 * teclear 26 caracteres con el teléfono en la otra mano.
 *
 * `qrcode` sabe pintar `type: 'utf8'`, pero devuelve una promesa y el handler del
 * comando es síncrono. Aquí se construye la matriz (`QRCode.create`, síncrono) y
 * se pinta con medios bloques: dos filas de módulos por línea de texto.
 *
 * **Esto necesita una fuente monoespaciada para escanearse.** Si el chat no la
 * usa, el QR se ve pero no se lee; por eso el comando también abre la página de
 * emparejamiento, que lo pinta como imagen.
 */
import QRCode from 'qrcode';

/** Módulos de margen alrededor del código. El estándar pide 4; con 2 basta y ocupa menos. */
const QUIET_ZONE = 2;

interface ModuleMatrix {
  size: number;
  get(row: number, column: number): number;
}

/** `1` si el módulo está encendido; `0` fuera de la matriz. */
function bit(matrix: ModuleMatrix, row: number, column: number): number {
  if (row < 0 || row >= matrix.size || column < 0 || column >= matrix.size) return 0;
  return matrix.get(row, column);
}

/**
 * Pinta la matriz con `▀`, `▄`, `█` y espacio.
 *
 * Cada carácter cubre dos filas de módulos: la mitad de arriba y la de abajo. Por
 * eso las líneas de salida son la mitad que las filas del código.
 */
export function qrText(text: string, quietZone: number = QUIET_ZONE): string {
  // `create` es síncrono, que es lo que necesita un handler de comando.
  // `modules` empaqueta los bits, así que se lee con `get`, no indexando `data`.
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

    // Sin espacios al final: el chat no los necesita y ensucian el copiar.
    lines.push(line.trimEnd());
  }

  return `${lines.join('\n')}\n(v${version}, ${matrix.size}×${matrix.size} módulos)`;
}
