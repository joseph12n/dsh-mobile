import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const DIR = join(DSH_HOME, 'companion');
const FILE = join(DIR, 'probe.log');
const MAX_LOG_BYTES = 1024 * 1024;

export const COMPANION_DIR = DIR;

const FILE_LOGGING = process.env.DSH_MOBILE_LOG_FILE !== '0';

let ready = false;

function ensureDir(): void {
  if (ready) return;
  mkdirSync(DIR, { recursive: true });
  ready = true;
}

export function rotateIfNeeded(file: string, limit = MAX_LOG_BYTES): void {
  try {
    if (statSync(file).size < limit) return;
    const previous = `${file}.1`;
    rmSync(previous, { force: true });
    renameSync(file, previous);
  } catch {}
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(`[dsh-mobile] ${message}`);
  if (!FILE_LOGGING) return;
  try {
    ensureDir();
    rotateIfNeeded(FILE);
    appendFileSync(FILE, `${line}\n`, 'utf8');
  } catch {}
}

export const PROBE_LOG_PATH = FILE;
