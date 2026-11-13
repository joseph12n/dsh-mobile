import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export function browserOpener(): string | undefined {
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'];
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
