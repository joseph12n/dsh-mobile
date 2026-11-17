import { describe, expect, it } from 'vitest';
import { resolveWorkspacePath, workspacePathOf } from './workspace-path.js';

describe('workspacePathOf', () => {
  it('acepta rutas relativas del workspace', () => {
    expect(workspacePathOf('docs/PRUEBA-VISOR.md')).toBe('docs/PRUEBA-VISOR.md');
    expect(workspacePathOf('./docs/a.md')).toBe('docs/a.md');
    expect(workspacePathOf('docs\\a.md')).toBe('docs/a.md');
  });

  it('quita la parte de ancla y de consulta', () => {
    expect(workspacePathOf('docs/a.md#tabla')).toBe('docs/a.md');
    expect(workspacePathOf('docs/a.md?v=1')).toBe('docs/a.md');
  });

  it('decodifica los espacios', () => {
    expect(workspacePathOf('docs/mi%20archivo.md')).toBe('docs/mi archivo.md');
  });

  it('deja fuera los enlaces externos y las anclas', () => {
    expect(workspacePathOf('https://example.com/a.md')).toBeUndefined();
    expect(workspacePathOf('mailto:hola@example.com')).toBeUndefined();
    expect(workspacePathOf('#seccion')).toBeUndefined();
    expect(workspacePathOf('//example.com/a.md')).toBeUndefined();
    expect(workspacePathOf('')).toBeUndefined();
  });

  it('no rompe con una codificación inválida', () => {
    expect(workspacePathOf('docs/%E0%A4%A.md')).toBeUndefined();
  });
});

describe('resolveWorkspacePath', () => {
  it('resuelve contra la carpeta del archivo abierto', () => {
    expect(resolveWorkspacePath('docs/a.md', 'b.md')).toBe('docs/b.md');
    expect(resolveWorkspacePath('docs/a.md', '../README.md')).toBe('README.md');
    expect(resolveWorkspacePath('docs/a.md', './sub/c.md')).toBe('docs/sub/c.md');
  });

  it('no sale de la raíz del workspace', () => {
    expect(resolveWorkspacePath('a.md', '../fuera.md')).toBeUndefined();
  });

  it('ignora los enlaces externos', () => {
    expect(resolveWorkspacePath('docs/a.md', 'https://example.com/x.md')).toBeUndefined();
  });
});
