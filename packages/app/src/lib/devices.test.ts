import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '@deepseekharness-mobile/protocol';
import { lastSeenLabel, sortDevices } from './devices.js';

const now = 1_760_000_000_000;

function device(id: string, lastSeenAt: number): DeviceInfo {
  return { id, name: id, createdAt: 1, lastSeenAt };
}

describe('sortDevices', () => {
  it('pone el dispositivo actual primero y después los más recientes', () => {
    const devices = [
      device('old', now - 90_000_000),
      device('me', now - 999),
      device('recent', now - 60_000),
    ];
    expect(sortDevices(devices, 'me').map((item) => item.id)).toEqual(['me', 'recent', 'old']);
  });

  it('no muta la lista original', () => {
    const devices = [device('a', 1), device('b', 2)];
    sortDevices(devices, 'a');
    expect(devices.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('lastSeenLabel', () => {
  const t = ((key: string, values?: Record<string, string | number>) =>
    values && 'count' in values ? `${key}:${values.count}` : key) as never;

  it('traduce la antigüedad con las claves de tiempo existentes', () => {
    expect(lastSeenLabel(now - 5_000, now, t)).toBe('time.now');
    expect(lastSeenLabel(now - 3 * 60_000, now, t)).toBe('time.minutes:3');
    expect(lastSeenLabel(now - 2 * 3_600_000, now, t)).toBe('time.hours:2');
    expect(lastSeenLabel(now - 4 * 86_400_000, now, t)).toBe('time.days:4');
  });

  it('devuelve vacío sin fecha', () => {
    expect(lastSeenLabel(0, now, t)).toBe('');
  });
});
