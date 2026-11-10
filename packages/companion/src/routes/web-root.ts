import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * Si nada existe, el plugin arranca igual y sirve solo la API: es mejor un host
 * sin interfaz que un host que no arranca.
 */
export function findWebRoot(moduleUrl: string = import.meta.url): string | undefined {
  const here = dirname(fileURLToPath(moduleUrl));

  const candidates = [
    process.env.DSH_MOBILE_WEB_ROOT?.trim(),
    join(here, 'web'),
    join(here, '..', '..', 'app', 'dist'),
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
