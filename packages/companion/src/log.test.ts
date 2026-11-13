import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rotateIfNeeded } from './log.js';

function tempFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mobile-log-'));
  return {
    file: join(dir, 'probe.log'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('rotación del log', () => {
  it('renombra el archivo cuando supera el límite', () => {
    const { file, cleanup } = tempFile();
    try {
      writeFileSync(file, 'x'.repeat(2048));
      rotateIfNeeded(file, 1024);
      expect(existsSync(file)).toBe(false);
      expect(readFileSync(`${file}.1`, 'utf8')).toHaveLength(2048);
    } finally {
      cleanup();
    }
  });

  it('no rota por debajo del límite', () => {
    const { file, cleanup } = tempFile();
    try {
      writeFileSync(file, 'x'.repeat(512));
      rotateIfNeeded(file, 1024);
      expect(existsSync(file)).toBe(true);
      expect(existsSync(`${file}.1`)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('reemplaza la copia anterior en lugar de fallar', () => {
    const { file, cleanup } = tempFile();
    try {
      writeFileSync(`${file}.1`, 'viejo');
      writeFileSync(file, 'y'.repeat(2048));
      rotateIfNeeded(file, 1024);
      expect(readFileSync(`${file}.1`, 'utf8')).toHaveLength(2048);
    } finally {
      cleanup();
    }
  });
});
