import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Registro de dispositivos emparejados.
 *
 * El token se entrega **una sola vez** al canjear el QR y nunca se guarda en
 * claro: sólo su hash SHA-256. Así, leer `devices.json` no permite suplantar a
 * ningún teléfono.
 *
 * Dominio puro: la persistencia entra por un puerto, de modo que el registro se
 * prueba entero en memoria.
 */

/** Datos públicos de un dispositivo. Nunca incluye el token ni su hash. */
export interface Device {
  id: string;
  name: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
}

/** Lo que se guarda en disco. El token sigue sin estar aquí. */
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
  /** Inyectable para pruebas. */
  generateToken?: () => string;
  generateId?: () => string;
}

export interface Enrolled {
  device: Device;
  /** Se entrega al cliente y no se puede recuperar después. */
  token: string;
}

/** SHA-256 en hexadecimal. Se usa para comparar y almacenar, nunca se invierte. */
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
      // Un archivo corrupto no debe impedir arrancar: se empieza vacío y el
      // usuario vuelve a emparejar.
      return [];
    }
  }

  /** Empareja un dispositivo nuevo y devuelve su token en claro, una única vez. */
  enroll(name: string, platform: string): Enrolled {
    const now = this.#now();
    const token = this.#generateToken();
    const stored: StoredDevice = {
      id: this.#generateId(),
      name: name.trim().slice(0, 64) || 'Dispositivo',
      platform: platform.slice(0, 64),
      createdAt: now,
      lastSeenAt: now,
      tokenHash: hashToken(token),
    };

    this.#devices = [...this.#devices, stored];
    this.#persist();

    return { device: toPublic(stored), token };
  }

  /**
   * Autentica un token. Devuelve el dispositivo, o `undefined` si no existe.
   *
   * Compara hashes en tiempo constante sobre el hex: no hay forma de recuperar el
   * token, así que no hay nada que adivinar por longitud.
   */
  authenticate(token: string): Device | undefined {
    if (!token) return undefined;
    const hash = hashToken(token);
    const found = this.#devices.find((device) => safeEqual(device.tokenHash, hash));
    if (!found) return undefined;

    // Se registra la última vez que se vio, pero no se persiste en cada latido:
    // eso escribiría en disco cada pocos segundos.
    found.lastSeenAt = this.#now();
    return toPublic(found);
  }

  /** Fija en disco el `lastSeenAt` que se fue acumulando en memoria. */
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
    } catch {
      // Si el disco falla, el registro en memoria sigue siendo correcto durante
      // esta sesión; el host decide si eso es aceptable.
    }
  }
}

function toPublic(stored: StoredDevice): Device {
  const { tokenHash: _ignored, ...device } = stored;
  return device;
}

/** Comparación en tiempo constante, para no filtrar por temporización. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
