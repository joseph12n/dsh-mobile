import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@typescript-eslint/typescript-estree';

const roots = [
  'packages/app/src',
  'packages/companion/src',
  'packages/protocol/src',
  'tools/preview',
  'scripts',
];

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) files.push(path);
  }
};

for (const root of roots) {
  try {
    walk(root);
  } catch {}
}

const directives = [];
const comments = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const ast = parse(text, {
    comment: true,
    loc: true,
    range: true,
    jsx: file.endsWith('.tsx'),
    sourceType: 'module',
  });
  for (const comment of ast.comments ?? []) {
    const value = comment.value.trim();
    if (value.startsWith('eslint-disable')) directives.push(`${file}:${comment.loc.start.line}`);
    else
      comments.push(
        `${file}:${comment.loc.start.line}: ${value.replace(/\s+/g, ' ').slice(0, 90)}`,
      );
  }
}

console.log(
  JSON.stringify(
    { files: files.length, directives, comments: comments.length, found: comments },
    null,
    2,
  ),
);
