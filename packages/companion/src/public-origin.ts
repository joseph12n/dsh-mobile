/**
 * Dirección pública del host, para mostrarla sin depender de una petición.
 *
 * El servidor deduce el origen de la cabecera `Host`, pero un comando del chat no
 * tiene petición: hay que averiguarlo de otra forma. Orden de preferencia:
 *
 *  1. `DSH_MOBILE_PUBLIC_URL`, si está configurada y es un origen válido.
 *  2. El nombre del tailnet, preguntando a `tailscale status --json`.
 *  3. El listener en loopback, con la advertencia de que no sirve desde el móvil.
 *
 * La consulta a Tailscale tiene tope de tiempo y cualquier fallo degrada al
 * siguiente nivel: el plugin no puede quedarse esperando a la red para pintar un
 * enlace.
 *
 * El binario se busca en **rutas absolutas conocidas**, nunca por `PATH`: lanzar un
 * ejecutable resuelto por `PATH` es una vulnerabilidad real (Sonar S4036), porque
 * cualquier cosa que se cuele antes en `PATH` se ejecuta con nuestros permisos.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isValidOrigin } from './routes/origin.js';

const TAILSCALE_TIMEOUT_MS = 1500;

/** Rutas donde se instala Tailscale, por plataforma. */
function binaryCandidates(): string[] {
  if (process.platform === 'win32') {
    // `join` en vez de concatenar: evita duplicar barras y las secuencias de
    // escape que el análisis estático marca (S7780).
    const programFiles = process.env['ProgramFiles'] ?? String.raw`C:\Program Files`;
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? String.raw`C:\Program Files (x86)`;
    return [
      join(programFiles, 'Tailscale', 'tailscale.exe'),
      join(programFilesX86, 'Tailscale', 'tailscale.exe'),
    ];
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      '/usr/local/bin/tailscale',
      '/opt/homebrew/bin/tailscale',
    ];
  }

  return ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/usr/sbin/tailscale'];
}

/** Primer binario que exista de verdad. */
export function findTailscaleBinary(candidates: string[] = binaryCandidates()): string | undefined {
  return candidates.find((candidate) => {
    try {
      return existsSync(candidate);
    } catch {
      return false;
    }
  });
}

export type OriginSource = 'config' | 'tailscale' | 'loopback';

export interface ResolvedOrigin {
  origin: string;
  source: OriginSource;
  /** `true` si el enlace no lleva a ninguna parte desde el teléfono. */
  loopback: boolean;
}

interface TailscaleStatus {
  Self?: { DNSName?: unknown };
}

/** Nombre DNS del equipo en el tailnet, sin el punto final. */
export function parseTailnetName(json: string): string | undefined {
  try {
    const parsed = JSON.parse(json) as TailscaleStatus;
    const dns = parsed.Self?.DNSName;
    if (typeof dns !== 'string' || !dns) return undefined;
    return dns.replace(/\.$/, '');
  } catch {
    return undefined;
  }
}

/** Quita los corchetes de una dirección IPv6. */
function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** Pregunta a Tailscale por el nombre del equipo. Nunca lanza. */
function tailnetName(): Promise<string | undefined> {
  const binary = findTailscaleBinary();
  if (!binary) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    execFile(
      binary,
      ['status', '--json'],
      { timeout: TAILSCALE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : parseTailnetName(stdout)),
    );
  });
}

/**
 * Resuelve el origen a mostrar.
 *
 * `port` es el del listener, para el último nivel. `lookup` permite inyectar la
 * consulta a Tailscale en las pruebas; en producción se usa la real.
 */
export async function resolvePublicOrigin(
  configured: string | undefined,
  port: number,
  lookup: () => Promise<string | undefined> = tailnetName,
): Promise<ResolvedOrigin> {
  // Quitar las barras finales con un bucle y no con `/\/+$/`: ese patrón puede
  // retroceder de forma superlineal con una cadena de barras (S8786).
  let fromConfig = configured?.trim() ?? '';
  while (fromConfig.endsWith('/')) fromConfig = fromConfig.slice(0, -1);

  // Una configuración inválida se descarta con el mismo criterio que el servidor:
  // si no es un origen, no se presenta como bueno.
  if (fromConfig && isValidOrigin(fromConfig)) {
    return { origin: fromConfig, source: 'config', loopback: isLoopback(fromConfig) };
  }

  const name = await lookup().catch(() => undefined);
  if (name) {
    return { origin: `https://${name}`, source: 'tailscale', loopback: false };
  }

  return { origin: `http://127.0.0.1:${port}`, source: 'loopback', loopback: true };
}

/** `true` si la dirección solo existe dentro de la máquina. */
export function isLoopback(origin: string): boolean {
  try {
    const host = stripBrackets(new URL(origin).hostname).toLowerCase();
    return host === 'localhost' || host === '::1' || host.startsWith('127.');
  } catch {
    return false;
  }
}
