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
        'Dejo el contexto en docs/MEMORIA.md y el logo en docs/logo.png, otra vez docs/logo.png.',
      ),
    ).toEqual(['docs/MEMORIA.md', 'docs/logo.png']);
  });

  it('ignora texto sin archivos', () => {
    expect(findFilePaths('Sin archivos por aquí.')).toEqual([]);
  });

  it('usa la ruta del enlace y no su texto', () => {
    expect(
      findFilePaths('Ver ([files.ts:53](packages/companion/src/dsh/files.ts#L53)) y nada más.'),
    ).toEqual(['packages/companion/src/dsh/files.ts']);
  });

  it('no hace cards de nombres sueltos, que no son rutas', () => {
    expect(findFilePaths('Toco `files.ts:72` y `README.md` pero no dicen dónde están.')).toEqual(
      [],
    );
  });
});
