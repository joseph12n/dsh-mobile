import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const DIR = join(DSH_HOME, 'companion');
const FILE = join(DIR, 'probe.log');

export const COMPANION_DIR = DIR;

const FILE_LOGGING = process.env.DSH_MOBILE_LOG_FILE !== '0';

let ready = false;

function ensureDir(): void {
  if (ready) return;
  mkdirSync(DIR, { recursive: true });
  ready = true;
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(`[dsh-mobile] ${message}`);
  if (!FILE_LOGGING) return;
  try {
    ensureDir();
    appendFileSync(FILE, `${line}\n`, 'utf8');
  } catch {}
}

export const PROBE_LOG_PATH = FILE;
