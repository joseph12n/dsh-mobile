import { createHash, randomBytes, randomUUID } from 'node:crypto';

export interface Device {
  id: string;
  name: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface StoredDevice extends Device {
  tokenHash: string;
}

export interface DevicePersistence {
  load(): StoredDevice[];
  save(devices: StoredDevice[]): void;
}

export interface DeviceRegistryOptions {
  persistence: DevicePersistence;
  now?: () => number;
  generateToken?: () => string;
  generateId?: () => string;
}

export interface Enrolled {
  device: Device;
  token: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export class DeviceRegistry {
  readonly #persistence: DevicePersistence;
  readonly #now: () => number;
  readonly #generateToken: () => string;
  readonly #generateId: () => string;
  #devices: StoredDevice[];

  constructor(options: DeviceRegistryOptions) {
    this.#persistence = options.persistence;
    this.#now = options.now ?? (() => Date.now());
    this.#generateToken = options.generateToken ?? (() => randomBytes(32).toString('base64url'));
    this.#generateId = options.generateId ?? (() => randomUUID());
    this.#devices = this.#loadSafely();
  }

  #loadSafely(): StoredDevice[] {
    try {
      return this.#persistence.load();
    } catch {
      return [];
    }
  }

  enroll(name: string, platform: string): Enrolled {
    const now = this.#now();
    const token = this.#generateToken();
    const stored: StoredDevice = {
      id: this.#generateId(),
      name: name.trim().slice(0, 64) || 'Device',
      platform: platform.slice(0, 64),
      createdAt: now,
      lastSeenAt: now,
      tokenHash: hashToken(token),
    };

    this.#devices = [...this.#devices, stored];
    this.#persist();

    return { device: toPublic(stored), token };
  }

  authenticate(token: string): Device | undefined {
    if (!token) return undefined;
    const hash = hashToken(token);
    const found = this.#devices.find((device) => safeEqual(device.tokenHash, hash));
    if (!found) return undefined;

    found.lastSeenAt = this.#now();
    return toPublic(found);
  }

  flush(): void {
    this.#persist();
  }

  list(): Device[] {
    return this.#devices.map(toPublic);
  }

  revoke(id: string): boolean {
    const before = this.#devices.length;
    this.#devices = this.#devices.filter((device) => device.id !== id);
    if (this.#devices.length === before) return false;
    this.#persist();
    return true;
  }

  #persist(): void {
    try {
      this.#persistence.save(this.#devices);
    } catch {}
  }
}

function toPublic(stored: StoredDevice): Device {
  const { tokenHash: _ignored, ...device } = stored;
  return device;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
