/**
 * Constantes del contrato.
 *
 * Una sola versión por ahora. Cuando cambie, sube `PROTOCOL_VERSION` y amplía
 * `SUPPORTED_PROTOCOL_VERSIONS`: el host acepta lo que entiende y rechaza lo
 * demás con un mensaje claro (`proto-unsupported`).
 */

export const PROTOCOL_NAME = 'dsh-mobile';

/** Versión que emite este build. */
export const PROTOCOL_VERSION = 1 as const;

/** Versiones que este build sabe atender. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

/** Ruta del WebSocket dentro del listener del plugin. */
export const WEBSOCKET_PATH = '/ws';

/** Tamaño máximo de un marco, en bytes. Protege al host de un cliente defectuoso. */
export const MAX_FRAME_BYTES = 64 * 1024;

/** Latido. Sin respuesta en dos intervalos, se cierra la conexión. */
export const HEARTBEAT_INTERVAL_MS = 20_000;

/** Vigencia de un código de emparejamiento. Un solo uso. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** Tope de marcos por minuto y conexión. */
export const MAX_FRAMES_PER_MINUTE = 600;

/** `true` si el host de este build puede hablar con la versión pedida. */
export function isSupportedVersion(version: number): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}
