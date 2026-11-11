// Extrae los tokens de color del tema oscuro de DSH y los resuelve a hexadecimal.
//
// Uso: node scripts/extract-dsh-tokens.mjs <ruta a client.js del paquete de tema>
//
// Por qué existe: para que la PWA se vea como el escritorio, en vez de inventar
// una paleta hay que leer la suya. Los alias (`--dsw-alias-*`) apuntan a
// primitivos (`--dsw-static-*`); esto sigue la cadena.
//
// Detalle que costó encontrar: el tema oscuro **no está en un solo bloque**. Hay
// varias reglas `body[data-ds-dark-theme]{…}` repartidas por el archivo, y una
// de ellas, la primera, solo redefine primitivos. Buscar la primera aparición
// devuelve colores claros.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('falta la ruta al client.js del paquete de tema');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');
const SELECTOR = 'body[data-ds-dark-theme]';

/** Devuelve el contenido de todas las reglas del selector, concatenado. */
function darkBlocks(source) {
  const parts = [];
  let from = 0;

  for (;;) {
    const start = source.indexOf(`${SELECTOR}{`, from);
    if (start < 0) break;

    const open = source.indexOf('{', start);
    let depth = 0;
    let index = open;

    for (; index < source.length; index += 1) {
      const character = source[index];
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    parts.push(source.slice(open + 1, index));
    from = index + 1;
  }

  return parts.join(';');
}

/** Recoge `nombre: valor` de todas las declaraciones de un prefijo. */
function collect(source, prefix) {
  const pattern = new RegExp(`(${prefix}[a-z0-9-]+)\\s*:\\s*([^;{}]{1,80});`, 'gi');
  const out = new Map();
  for (const match of source.matchAll(pattern)) {
    if (!out.has(match[1])) out.set(match[1], match[2].trim());
  }
  return out;
}

const darkCss = darkBlocks(raw);

// Los primitivos del tema oscuro mandan sobre los del claro cuando difieren.
const statics = new Map([...collect(raw, '--dsw-static-'), ...collect(darkCss, '--dsw-static-')]);
const aliases = collect(darkCss, '--dsw-alias-');

/** Resuelve `var(--x)` hasta un valor literal. */
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
