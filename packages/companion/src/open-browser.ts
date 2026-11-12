/**
 * Opens a URL in the desktop browser.
 *
 * This is the **main** path for pairing: the QR is a real image on `/pair`, so it
 * scans regardless of what font the chat uses. A text QR cannot promise that.
 *
 * Executables are looked up by **absolute path**, never through `PATH`: launching
 * something resolved by `PATH` is a real vulnerability (Sonar S4036), because
 * anything earlier in `PATH` runs with our permissions.
 *
 * The exit code is deliberately ignored. On Windows, `explorer.exe <url>` exits
 * with code 1 **even when it opens the page**, so trusting the code reported
 * failures for successes.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Absolute path of the URL opener, per platform. */
export function browserOpener(): string | undefined {
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'];
    // Only an absolute `SystemRoot` is usable: an empty or relative one would make
    // `join` return a relative path, and a relative path is what we are avoiding.
    if (systemRoot && isAbsolute(systemRoot)) candidates.push(join(systemRoot, 'explorer.exe'));
    candidates.push(join('C:\\Windows', 'explorer.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push('/usr/bin/open');
  } else {
    candidates.push('/usr/bin/xdg-open', '/usr/local/bin/xdg-open', '/bin/xdg-open');
  }

  return candidates.find((candidate) => {
    if (!isAbsolute(candidate)) return false;
    try {
      return existsSync(candidate);
    } catch {
      return false;
    }
  });
}

/**
 * Opens the URL if it can. **Never throws.**
 *
 * Resolves `true` when the process starts. It resolves on spawn rather than on
 * exit because the exit code of `explorer.exe` says nothing about whether the page
 * opened.
 */
export function openInBrowser(url: string, opener = browserOpener()): Promise<boolean> {
  if (!opener) return Promise.resolve(false);

  return new Promise((resolve) => {
    try {
      const child = spawn(opener, [url], { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
