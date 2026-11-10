/**
 * Estado local del emparejamiento.
 *
 * El token de dispositivo es una credencial de larga vida, así que se guarda
 * aparte del resto de preferencias y con una nota honesta: `localStorage` no es
 * un almacén seguro frente a XSS. Se acepta porque la PWA entera se sirve desde
 * el propio host (no hay terceros en el origen) y porque el alcance del token es
 * acotado: sesiones, preguntas y ejecuciones, nada de credenciales.
 *
 * Endurecerlo a IndexedDB con cifrado por clave derivada está en el roadmap.
 */

const TOKEN_KEY = 'dsh-mobile.device-token';
const ENDPOINT_KEY = 'dsh-mobile.endpoint';

function safeRead(key: string): string | undefined {
  try {
    return globalThis.localStorage.getItem(key) ?? undefined;
  } catch {
    // Navegación privada o almacenamiento bloqueado.
    return undefined;
  }
}

function safeWrite(key: string, value: string | undefined): void {
  try {
    if (value === undefined) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento la sesión dura hasta recargar; es aceptable.
  }
}

export const storage = {
  token: (): string | undefined => safeRead(TOKEN_KEY),
  saveToken: (token: string | undefined): void => safeWrite(TOKEN_KEY, token),

  endpoint: (): string | undefined => safeRead(ENDPOINT_KEY),
  saveEndpoint: (endpoint: string | undefined): void => safeWrite(ENDPOINT_KEY, endpoint),
};
