import { describe, expect, it } from 'vitest';
import { DeviceRegistry, hashToken, type DevicePersistence, type StoredDevice } from './devices.js';

/** Persistencia en memoria: el registro se prueba sin tocar disco. */
class MemoryPersistence implements DevicePersistence {
  devices: StoredDevice[] = [];
  saves = 0;

  load(): StoredDevice[] {
    return this.devices;
  }

  save(devices: StoredDevice[]): void {
    this.devices = devices;
    this.saves += 1;
  }
}

function makeRegistry(startAt = 1_000_000): {
  registry: DeviceRegistry;
  persistence: MemoryPersistence;
  advance: (ms: number) => void;
} {
  let now = startAt;
  let counter = 0;
  const persistence = new MemoryPersistence();
  const registry = new DeviceRegistry({
    persistence,
    now: () => now,
    generateToken: () => `token-${(counter += 1)}-secreto`,
    generateId: () => `device-${counter}`,
  });
  return { registry, persistence, advance: (ms: number) => (now += ms) };
}

describe('registro de dispositivos', () => {
  it('empareja y devuelve el token una vez', () => {
    const { registry } = makeRegistry();
    const enrolled = registry.enroll('Pixel de José', 'android');

    expect(enrolled.token).toBe('token-1-secreto');
    expect(enrolled.device.name).toBe('Pixel de José');
    expect(enrolled.device.platform).toBe('android');
  });

  it('nunca guarda el token en claro', () => {
    const { registry, persistence } = makeRegistry();
    const { token } = registry.enroll('Pixel', 'android');

    expect(JSON.stringify(persistence.devices)).not.toContain(token);
    expect(persistence.devices[0]?.tokenHash).toBe(hashToken(token));
  });

  it('no expone el hash al listar', () => {
    const { registry } = makeRegistry();
    registry.enroll('Pixel', 'android');
    const listed = registry.list()[0] as unknown as Record<string, unknown>;
    expect(listed['tokenHash']).toBeUndefined();
  });

  it('autentica el token correcto y rechaza el resto', () => {
    const { registry } = makeRegistry();
    const { token, device } = registry.enroll('Pixel', 'android');

    expect(registry.authenticate(token)?.id).toBe(device.id);
    expect(registry.authenticate(`${token}x`)).toBeUndefined();
    expect(registry.authenticate('')).toBeUndefined();
  });

  it('actualiza lastSeenAt al autenticar sin escribir en disco', () => {
    const { registry, persistence, advance } = makeRegistry();
    const { token } = registry.enroll('Pixel', 'android');
    const savesBefore = persistence.saves;

    advance(5_000);
    const seen = registry.authenticate(token);
    expect(seen?.lastSeenAt).toBe(1_005_000);
    expect(persistence.saves).toBe(savesBefore);
  });

  it('revoca un dispositivo y su token deja de valer', () => {
    const { registry } = makeRegistry();
    const { token, device } = registry.enroll('Pixel', 'android');

    expect(registry.revoke(device.id)).toBe(true);
    expect(registry.authenticate(token)).toBeUndefined();
    expect(registry.list()).toHaveLength(0);
  });

  it('revocar uno no afecta a los demás', () => {
    const { registry } = makeRegistry();
    const first = registry.enroll('Uno', 'android');
    const second = registry.enroll('Dos', 'ios');

    registry.revoke(first.device.id);
    expect(registry.authenticate(second.token)?.name).toBe('Dos');
  });

  it('recarga los dispositivos del disco al construirse', () => {
    const { registry, persistence } = makeRegistry();
    const { token } = registry.enroll('Pixel', 'android');

    const reopened = new DeviceRegistry({ persistence });
    expect(reopened.authenticate(token)?.name).toBe('Pixel');
  });

  it('sobrevive a un archivo corrupto', () => {
    const persistence: DevicePersistence = {
      load: () => {
        throw new Error('JSON roto');
      },
      save: () => undefined,
    };
    const registry = new DeviceRegistry({ persistence });
    expect(registry.list()).toHaveLength(0);
    // Sigue siendo usable para emparejar de nuevo.
    expect(registry.enroll('Pixel', 'android').device.name).toBe('Pixel');
  });

  it('recorta nombres absurdamente largos', () => {
    const { registry } = makeRegistry();
    const enrolled = registry.enroll('x'.repeat(200), 'android');
    expect(enrolled.device.name).toHaveLength(64);
  });
});
