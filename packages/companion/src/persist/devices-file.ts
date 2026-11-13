import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DevicePersistence, StoredDevice } from '../core/devices.js';

export class DevicesFile implements DevicePersistence {
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  load(): StoredDevice[] {
    let raw: string;
    try {
      raw = readFileSync(this.#file, 'utf8');
    } catch {
      return [];
    }

    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isStoredDevice);
  }

  save(devices: StoredDevice[]): void {
    const dir = dirname(this.#file);
    mkdirSync(dir, { recursive: true });

    const temp = `${this.#file}.tmp`;
    writeFileSync(temp, JSON.stringify(devices, null, 2), { encoding: 'utf8' });

    try {
      renameSync(temp, this.#file);
    } catch {
      writeFileSync(this.#file, JSON.stringify(devices, null, 2), { encoding: 'utf8' });
    }
  }
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    typeof record['name'] === 'string' &&
    typeof record['platform'] === 'string' &&
    typeof record['tokenHash'] === 'string' &&
    typeof record['createdAt'] === 'number' &&
    typeof record['lastSeenAt'] === 'number'
  );
}
