import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');

const BACKGROUND = '#151517';
const check = process.argv.includes('--check');

async function render(svg, size, opaque) {
  let pipeline = sharp(join(pub, svg), { density: 384 }).resize(size, size, { fit: 'contain' });
  if (opaque) pipeline = pipeline.flatten({ background: BACKGROUND });
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

async function pixels(source) {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function sameImage(a, b) {
  const [left, right] = await Promise.all([pixels(a), pixels(b)]);
  return left.width === right.width && left.height === right.height && left.data.equals(right.data);
}

const targets = [
  { output: 'icon-192.png', svg: 'icon.svg', size: 192, opaque: false },
  { output: 'icon-512.png', svg: 'icon.svg', size: 512, opaque: false },
  { output: 'icon-maskable-512.png', svg: 'icon-maskable.svg', size: 512, opaque: false },
  { output: 'apple-touch-icon.png', svg: 'icon-maskable.svg', size: 180, opaque: true },
];

let stale = 0;

for (const target of targets) {
  const generated = await render(target.svg, target.size, target.opaque);
  const path = join(pub, target.output);

  if (!check) {
    await writeFile(path, generated);
    console.log(`${target.output} · ${target.size}x${target.size}`);
    continue;
  }

  let current;
  try {
    current = await readFile(path);
  } catch {
    console.error(`falta ${target.output}`);
    stale += 1;
    continue;
  }

  if (!(await sameImage(current, generated))) {
    console.error(`${target.output} no coincide con ${target.svg}`);
    stale += 1;
  }
}

const precomposed = join(pub, 'apple-touch-icon-precomposed.png');
const apple = join(pub, 'apple-touch-icon.png');

if (check) {
  const expected = await readFile(apple).catch(() => undefined);
  const copy = await readFile(precomposed).catch(() => undefined);

  if (!expected || !copy || !(await sameImage(expected, copy))) {
    console.error('apple-touch-icon-precomposed.png no coincide con apple-touch-icon.png');
    stale += 1;
  }

  if (stale > 0) {
    console.error(
      `\n${stale} icono(s) desactualizado(s). Ejecuta: pnpm --filter @deepseekharness-mobile/app icons`,
    );
    process.exit(1);
  }

  console.log('iconos al día');
} else {
  await writeFile(precomposed, await readFile(apple));
  console.log('listo');
}
