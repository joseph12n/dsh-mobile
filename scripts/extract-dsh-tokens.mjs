import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('falta la ruta al client.js del paquete de tema');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');

const SELECTOR = /body\[data-ds-dark-theme\]\s*\{/g;

function darkBlocks(source) {
  const parts = [];

  for (const match of source.matchAll(SELECTOR)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let index = open;

    for (; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    parts.push(source.slice(open + 1, index));
  }

  if (parts.length === 0) return '';

  return `${parts.join(';')};`;
}

const DECLARATION = /(--dsw-(?:alias|static)-[a-z0-9-]+)\s*:\s*([^;{}]{1,200});/gi;

function collect(source) {
  const out = new Map();
  for (const match of source.matchAll(DECLARATION)) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

function only(declarations, prefix) {
  return new Map([...declarations].filter(([name]) => name.startsWith(prefix)));
}

const darkCss = darkBlocks(raw);

if (darkCss.length === 0) {
  console.error('no encontré ningún bloque del tema oscuro: ¿cambió el formato del paquete?');
  process.exit(1);
}

const statics = new Map(
  [...collect(raw), ...collect(darkCss)].filter(([name]) => name.startsWith('--dsw-static-')),
);
const aliases = only(collect(darkCss), '--dsw-alias-');

function resolve(value, seen = new Set()) {
  const reference = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
  if (!reference) return value;
  const name = reference[1];
  if (seen.has(name)) return value;
  seen.add(name);
  const next = aliases.get(name) ?? statics.get(name);
  return next === undefined ? value : resolve(next, seen);
}

const resolved = {};
let unresolved = 0;

for (const [name, value] of aliases) {
  const final = resolve(value);
  if (final.startsWith('var(')) unresolved += 1;
  else resolved[name.replace('--dsw-alias-', '')] = final;
}

console.log(
  `bloques oscuros: ${darkCss.length} caracteres · primitivos: ${statics.size} · ` +
    `alias: ${aliases.size} · resueltos: ${Object.keys(resolved).length} · sin resolver: ${unresolved}`,
);
console.log('---');

const groups = [
  /^bg-/,
  /^label-/,
  /^border-/,
  /^brand-/,
  /^state-/,
  /^button-/,
  /^interactive-/,
  /^link$/,
  /^markdown-/,
  /^toast-/,
  /^tooltip-/,
];

for (const group of groups) {
  const entries = Object.entries(resolved)
    .filter(([name]) => group.test(name))
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) continue;

  console.log(`[${group.source.replace('^', '').replace('-', '')}]`);
  for (const [name, value] of entries) console.log(`  ${name} = ${value}`);
}

if (unresolved > 0) {
  console.error(`\n${unresolved} alias sin resolver: revisa si el paquete cambió`);
  process.exit(1);
}
