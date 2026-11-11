// Genera los PNG del manifest a partir de los SVG.
//
//   pnpm --filter @dsh-mobile/app icons
//
// Chromium exige PNG de 192 y 512 para ofrecer el aviso de instalación: un SVG
// con `sizes: "any"` no le basta. iOS, además, no lee el manifest y quiere su
// propio `apple-touch-icon` opaco.
//
// Los PNG se commitean: así el build y la CI no necesitan sharp ni esta máquina.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');

const BACKGROUND = '#0b0f14';

/** Un PNG cuadrado a partir de un SVG del directorio público. */
async function render(svg, size, output, opaque) {
  const source = join(pub, svg);
  const target = join(pub, output);

  let pipeline = sharp(source, { density: 384 }).resize(size, size, { fit: 'contain' });

  // iOS no admite transparencia en el icono de inicio: aplana sobre el fondo.
  if (opaque) {
    pipeline = pipeline.flatten({ background: BACKGROUND });
  }

  await pipeline.png({ compressionLevel: 9 }).toFile(target);
  console.log(`${output} · ${size}x${size}`);
}

await mkdir(pub, { recursive: true });

await render('icon.svg', 192, 'icon-192.png', false);
await render('icon.svg', 512, 'icon-512.png', false);
await render('icon-maskable.svg', 512, 'icon-maskable-512.png', false);
await render('icon-maskable.svg', 180, 'apple-touch-icon.png', true);

// Una copia con el nombre que iOS busca por convención cuando no hay enlace.
await copyFile(join(pub, 'apple-touch-icon.png'), join(pub, 'apple-touch-icon-precomposed.png'));

console.log('listo');
