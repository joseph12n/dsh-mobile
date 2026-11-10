import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Registro de la Fase 0.
 *
 * Escribe a consola (que termina en los logs de DSH) y a un archivo propio, para
 * que la evidencia del spike se pueda inspeccionar sin depender de dónde acabe
 * la salida del proceso de escritorio.
 */

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const DIR = join(DSH_HOME, 'companion');
const FILE = join(DIR, 'probe.log');

/** Directorio de estado del plugin (tokens, QR, logs). */
export const COMPANION_DIR = DIR;

/** En pruebas se apaga la escritura a disco para no ensuciar el log del usuario. */
const FILE_LOGGING = process.env.DSH_MOBILE_LOG_FILE !== '0';

let ready = false;

function ensureDir(): void {
  if (ready) return;
  mkdirSync(DIR, { recursive: true });
  ready = true;
}

/** Escribe una línea de evidencia. Nunca lanza: un log no puede tumbar el host. */
export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(`[dsh-mobile] ${message}`);
  if (!FILE_LOGGING) return;
  try {
    ensureDir();
    appendFileSync(FILE, `${line}\n`, 'utf8');
  } catch {
    // Sin disco disponible, la consola ya tiene la evidencia.
  }
}

/** Ruta del archivo de evidencia, para anunciarla en el comando. */
export const PROBE_LOG_PATH = FILE;
