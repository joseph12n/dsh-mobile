// Genera los PNG del manifest a partir de los SVG.
//
//   pnpm --filter @dsh-mobile/app icons            # escribe los PNG
//   pnpm --filter @dsh-mobile/app icons -- --check # comprueba que están al día
//
// Chromium exige PNG de 192 y 512 para ofrecer el aviso de instalación: un SVG
// con `sizes: "any"` no le basta. iOS, además, no lee el manifest y quiere su
// propio `apple-touch-icon` opaco.
//
// Los PNG se commitean, así que **el build** no ejecuta sharp. La CI sí lo hace,
// porque tiene un paso `Iconos al día` que los comprueba: es la guardia contra
// editar un SVG y olvidar regenerar. Sin ella, el fallo es silencioso y solo se
// ve al instalar la app en el teléfono.
//
// Dos detalles que costaron un rato:
//
//  - El buffer ya es un PNG. Reencodearlo (`sharp(buffer).toFile()`) cambia los
//    bytes sin cambiar la imagen, y hacía que `--check` dijera siempre "viejo"
//    justo después de regenerar. Se escribe el buffer tal cual.
//  - La comprobación compara **píxeles**, no bytes: el codificador PNG puede
//    cambiar entre versiones de sharp o de plataforma y seguir siendo el mismo
//    icono.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');

const BACKGROUND = '#151517';
const check = process.argv.includes('--check');

/** Un PNG cuadrado a partir de un SVG del directorio público, en memoria. */
async function render(svg, size, opaque) {
  let pipeline = sharp(join(pub, svg), { density: 384 }).resize(size, size, { fit: 'contain' });
  if (opaque) pipeline = pipeline.flatten({ background: BACKGROUND });
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

/** Píxeles crudos y dimensiones, para comparar dos imágenes por contenido. */
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

// iOS busca este nombre por convención cuando no hay enlace en el HTML.
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
      `\n${stale} icono(s) desactualizado(s). Ejecuta: pnpm --filter @dsh-mobile/app icons`,
    );
    process.exit(1);
  }

  console.log('iconos al día');
} else {
  await writeFile(precomposed, await readFile(apple));
  console.log('listo');
}
