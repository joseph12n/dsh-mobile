import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findWebRoot(moduleUrl: string = import.meta.url): string | undefined {
  const here = dirname(fileURLToPath(moduleUrl));
  const packageDir = resolve(here, '..');

  const candidates = [
    process.env.DSH_MOBILE_WEB_ROOT?.trim(),
    join(packageDir, 'web'),
    join(packageDir, '..', '..', 'app', 'dist'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      if (existsSync(join(candidate, 'index.html'))) return candidate;
    } catch {}
  }

  return undefined;
}
