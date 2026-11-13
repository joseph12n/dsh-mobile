import QRCode from 'qrcode';

const QUIET_ZONE = 2;

interface ModuleMatrix {
  size: number;
  get(row: number, column: number): number;
}

function bit(matrix: ModuleMatrix, row: number, column: number): number {
  if (row < 0 || row >= matrix.size || column < 0 || column >= matrix.size) return 0;
  return matrix.get(row, column);
}

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
