// Genera los PNG del manifest a partir de los SVG.
//
//   pnpm --filter @dsh-mobile/app icons           # escribe los PNG
//   pnpm --filter @dsh-mobile/app icons -- --check # solo comprueba que están al día
//
// Chromium exige PNG de 192 y 512 para ofrecer el aviso de instalación: un SVG
// con `sizes: "any"` no le basta. iOS, además, no lee el manifest y quiere su
// propio `apple-touch-icon` opaco.
//
// Los PNG se commitean: así el build y la CI no necesitan ejecutar sharp. A
// cambio hay un riesgo real —editar el SVG y olvidar regenerar—, y por eso
// existe `--check`, que compara byte a byte y falla en CI si no coinciden.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');

const BACKGROUND = '#0b0f14';
const check = process.argv.includes('--check');

/** Un PNG cuadrado a partir de un SVG del directorio público, en memoria. */
async function render(svg, size, opaque) {
  let pipeline = sharp(join(pub, svg), { density: 384 }).resize(size, size, { fit: 'contain' });

  // iOS no admite transparencia en el icono de inicio: aplana sobre el fondo.
  if (opaque) pipeline = pipeline.flatten({ background: BACKGROUND });

  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

/** Salidas esperadas: nombre, origen, tamaño y si debe ser opaco. */
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

  if (check) {
    let current;
    try {
      current = await readFile(path);
    } catch {
      console.error(`falta ${target.output}`);
      stale += 1;
      continue;
    }

    if (!current.equals(generated)) {
      console.error(`${target.output} está desactualizado respecto a ${target.svg}`);
      stale += 1;
    }
    continue;
  }

  await sharp(generated).toFile(path);
  console.log(`${target.output} · ${target.size}x${target.size}`);
}

// iOS busca este nombre por convención cuando no hay enlace en el HTML.
const precomposed = join(pub, 'apple-touch-icon-precomposed.png');
const apple = await readFile(join(pub, 'apple-touch-icon.png'));

if (check) {
  if (!apple.equals(await readFile(precomposed).catch(() => Buffer.alloc(0)))) {
    console.error('apple-touch-icon-precomposed.png está desactualizado');
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
  await sharp(apple).toFile(precomposed);
  console.log('listo');
}
