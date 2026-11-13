export const PROTOCOL_NAME = 'dsh-mobile';

export const PROTOCOL_VERSION = 1 as const;

export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

export const WEBSOCKET_PATH = '/ws';

export const MAX_FRAME_BYTES = 64 * 1024;

export const HEARTBEAT_INTERVAL_MS = 20_000;

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export const MAX_FRAMES_PER_MINUTE = 600;

export function isSupportedVersion(version: number): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
