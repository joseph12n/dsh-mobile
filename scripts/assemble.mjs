import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repo, 'packages', 'app', 'dist');
const target = join(repo, 'packages', 'companion', 'dist', 'web');

if (!existsSync(join(source, 'index.html'))) {
  throw new Error(`No hay PWA compilada en ${source}. Compila la app antes de ensamblar.`);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

console.log(`PWA copiada a ${target}`);
