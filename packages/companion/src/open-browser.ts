/**
 * Abre una URL en el navegador del escritorio.
 *
 * Es la red de seguridad del QR en texto: si la fuente del chat no es
 * monoespaciada, el QR se ve y no se lee. Abrir `/pair` en el navegador da el
 * mismo código pintado como imagen.
 *
 * Los ejecutables se buscan en **rutas absolutas**, nunca por `PATH`: lanzar algo
 * resuelto por `PATH` es una vulnerabilidad (Sonar S4036), porque cualquier cosa
 * que se cuele antes se ejecuta con nuestros permisos.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TIMEOUT_MS = 3000;

/** Ruta absoluta del abridor de URLs, por plataforma. */
export function browserOpener(): string | undefined {
  const candidatos: string[] = [];

  if (process.platform === 'win32') {
    const system = process.env['SystemRoot'] ?? String.raw`C:\Windows`;
    candidatos.push(join(system, 'explorer.exe'));
  } else if (process.platform === 'darwin') {
    candidatos.push('/usr/bin/open');
  } else {
    candidatos.push('/usr/bin/xdg-open', '/usr/local/bin/xdg-open', '/bin/xdg-open');
  }

  return candidatos.find((candidato) => {
    try {
      return existsSync(candidato);
    } catch {
      return false;
    }
  });
}

/**
 * Abre la URL si se puede. **Nunca lanza**: que no se abra el navegador no puede
 * tumbar el comando que ya tiene el enlace en la mano.
 */
export function openInBrowser(url: string, opener = browserOpener()): Promise<boolean> {
  if (!opener) return Promise.resolve(false);

  return new Promise((resolve) => {
    execFile(opener, [url], { timeout: TIMEOUT_MS, windowsHide: true }, (error) =>
      resolve(error === null),
    );
  });
}
