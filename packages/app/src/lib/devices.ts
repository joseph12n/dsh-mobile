import type { DeviceInfo } from '@dsh-mobile/protocol';
import type { Translate } from '../i18n/index.js';
import type { MessageKey } from '../i18n/locales.js';
import { elapsed } from './sessions.js';

const UNIT_KEY: Record<'now' | 'minutes' | 'hours' | 'days', MessageKey> = {
  now: 'time.now',
  minutes: 'time.minutes',
  hours: 'time.hours',
  days: 'time.days',
};

export function sortDevices(devices: readonly DeviceInfo[], currentId?: string): DeviceInfo[] {
  return [...devices].sort((left, right) => {
    if (left.id === currentId) return -1;
    if (right.id === currentId) return 1;
    return right.lastSeenAt - left.lastSeenAt;
  });
}

export function lastSeenLabel(at: number, now: number, t: Translate): string {
  const age = elapsed(at, now);
  if (!age) return '';
  return t(UNIT_KEY[age.unit], 'count' in age ? { count: age.count } : {});
}
