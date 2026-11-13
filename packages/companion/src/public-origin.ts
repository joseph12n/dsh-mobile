import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isValidOrigin } from './routes/origin.js';

const TAILSCALE_TIMEOUT_MS = 1500;

function binaryCandidates(): string[] {
  if (process.platform === 'win32') {
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
  loopback: boolean;
}

interface TailscaleStatus {
  Self?: { DNSName?: unknown };
}

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

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

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

export async function resolvePublicOrigin(
  configured: string | undefined,
  port: number,
  lookup: () => Promise<string | undefined> = tailnetName,
): Promise<ResolvedOrigin> {
  let fromConfig = configured?.trim() ?? '';
  while (fromConfig.endsWith('/')) fromConfig = fromConfig.slice(0, -1);

  if (fromConfig && isValidOrigin(fromConfig)) {
    return { origin: fromConfig, source: 'config', loopback: isLoopback(fromConfig) };
  }

  const name = await lookup().catch(() => undefined);
  if (name) {
    return { origin: `https://${name}`, source: 'tailscale', loopback: false };
  }

  return { origin: `http://127.0.0.1:${port}`, source: 'loopback', loopback: true };
}

export function isLoopback(origin: string): boolean {
  try {
    const host = stripBrackets(new URL(origin).hostname).toLowerCase();
    return host === 'localhost' || host === '::1' || host.startsWith('127.');
  } catch {
    return false;
  }
}
