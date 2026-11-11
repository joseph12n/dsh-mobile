import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dónde vive la PWA compilada.
 *
 * Se resuelve en este orden, del más explícito al más implícito:
 *
 *  1. `DSH_MOBILE_WEB_ROOT` — para desarrollo y para montajes raros.
 *  2. `<plugin>/dist/web` — así se publica: un solo artefacto con host y cliente.
 *  3. `<plugin>/../../app/dist` — monorepo, cuando la PWA se compila aparte.
 *
 * Este módulo vive en `dist/routes/`, no en `dist/`, así que el directorio del
 * paquete es **el padre** del que contiene al archivo. Confundirlo hacía que el
 * servidor no encontrara nunca la PWA y `/` devolviera 404.
 *
 * Si nada existe, el plugin arranca igual y sirve solo la API: es mejor un host
 * sin interfaz que un host que no arranca.
 */
export function findWebRoot(moduleUrl: string = import.meta.url): string | undefined {
  const here = dirname(fileURLToPath(moduleUrl));
  // `dist/routes` → `dist`; en pruebas, `src/routes` → `src`. Las dos sirven,
  // porque `packages/companion/{src,dist}` están al mismo nivel.
  const packageDir = resolve(here, '..');

  const candidates = [
    process.env.DSH_MOBILE_WEB_ROOT?.trim(),
    join(packageDir, 'web'),
    join(packageDir, '..', '..', 'app', 'dist'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, 'index.html'))) return candidate;
    } catch {
      // Una ruta ilegible simplemente no es candidata.
    }
  }

  return undefined;
}
