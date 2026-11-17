import { describe, expect, it } from 'vitest';
import { fileKindOf, findFilePaths } from './files.js';

describe('fileKindOf', () => {
  it('clasifica por extensión', () => {
    expect(fileKindOf('docs/MEMORIA.md')).toBe('markdown');
    expect(fileKindOf('logo.PNG')).toBe('image');
    expect(fileKindOf('informe.docx')).toBe('office');
    expect(fileKindOf('contrato.pdf')).toBe('pdf');
    expect(fileKindOf('src/index.ts')).toBe('text');
    expect(fileKindOf('bin/app.exe')).toBe('other');
  });
});

describe('findFilePaths', () => {
  it('encuentra rutas y elimina duplicados', () => {
    expect(
      findFilePaths(
        'Dejo el contexto en `MEMORIA.md` y el logo en docs/logo.png, otra vez MEMORIA.md.',
      ),
    ).toEqual(['MEMORIA.md', 'docs/logo.png']);
  });

  it('ignora texto sin archivos', () => {
    expect(findFilePaths('Sin archivos por aquí.')).toEqual([]);
  });
});
