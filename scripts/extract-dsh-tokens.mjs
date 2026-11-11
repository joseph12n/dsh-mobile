// Extrae los tokens de color del tema oscuro de DSH y los resuelve a hexadecimal.
//
// Uso: node scripts/extract-dsh-tokens.mjs <ruta a client.js del paquete de tema>
//
// Por qué existe: para que la PWA se vea como el escritorio, en vez de inventar
// una paleta hay que leer la suya. Los alias (`--dsw-alias-*`) apuntan a
// primitivos (`--dsw-static-*`); esto sigue la cadena.
//
// Detalles que costaron encontrar:
//
//  - El tema oscuro **no está en un solo bloque**. Hay varias reglas
//    `body[data-ds-dark-theme]{…}` repartidas, y de ellas la primera solo
//    redefine primitivos. Buscar la primera aparición devuelve colores claros.
//  - En una cascada gana la **última** declaración, no la primera.
import { readFileSync } from 'node:fs';

// La ruta la escribe quien ejecuta la herramienta en su propia máquina: no hay
// entrada no confiable. El análisis estático marca la lectura como ruta
// controlada por el usuario; el NOSONAR va en esa línea, no aquí.
const file = process.argv[2];
if (!file) {
  console.error('falta la ruta al client.js del paquete de tema');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8'); // NOSONAR: la ruta la da quien ejecuta la herramienta

// Se permite espacio antes de la llave: un `body[data-ds-dark-theme] {` con
// espacio devolvía cero bloques y el script salía con éxito, sin avisar.
const SELECTOR = /body\[data-ds-dark-theme\]\s*\{/g;

/** Contenido de todas las reglas del selector, concatenado. */
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

  // Sin bloques se devuelve vacío, para que la guarda de más abajo lo detecte.
  if (parts.length === 0) return '';

  // Cada bloque se cierra con `;`: en CSS minificado la última declaración de una
  // regla puede no llevarlo, y sin esto el alias se perdía en silencio.
  return `${parts.join(';')};`;
}

/**
 * Declaraciones de un prefijo, en orden de cascada.
 *
 * Una sola expresión literal para los dos prefijos: construir el patrón con una
 * variable es lo que marcaba el análisis estático.
 */
const DECLARATION = /(--dsw-(?:alias|static)-[a-z0-9-]+)\s*:\s*([^;{}]{1,200});/gi;

function collect(source) {
  const out = new Map();
  for (const match of source.matchAll(DECLARATION)) {
    // El valor más reciente gana: es lo que hace un navegador.
    out.set(match[1], match[2].trim());
  }
  return out;
}

/** Solo las de un prefijo concreto. */
function only(declarations, prefix) {
  return new Map([...declarations].filter(([name]) => name.startsWith(prefix)));
}

const darkCss = darkBlocks(raw);

if (darkCss.length === 0) {
  console.error('no encontré ningún bloque del tema oscuro: ¿cambió el formato del paquete?');
  process.exit(1);
}

// Los primitivos del tema oscuro mandan sobre los claros cuando difieren.
const statics = new Map(
  [...collect(raw), ...collect(darkCss)].filter(([name]) => name.startsWith('--dsw-static-')),
);
const aliases = only(collect(darkCss), '--dsw-alias-');

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

if (unresolved > 0) {
  console.error(`\n${unresolved} alias sin resolver: revisa si el paquete cambió`);
  process.exit(1);
}
