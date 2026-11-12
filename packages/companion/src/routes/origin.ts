/**
 * Origen público del host.
 *
 * El QR tiene que apuntar a una dirección que **el teléfono pueda alcanzar**.
 * Antes se construía siempre desde el listener (`127.0.0.1`), y ese enlace
 * escaneado desde un móvil apunta al propio móvil: el navegador responde
 * "conexión rechazada" y no hay forma de saber por qué.
 *
 * Regla: se usa la dirección por la que **entraron** a la página de
 * emparejamiento. Quien abre `/pair` en `https://maquina.tailnet.ts.net/pair`
 * recibe un QR para esa misma dirección. Así funciona igual por tailnet, por LAN
 * o en local, sin configuración.
 *
 * `DSH_MOBILE_PUBLIC_URL` sigue mandando: sirve cuando hay un proxy que no
 * propaga el `Host` original.
 *
 * La cabecera `Host` la controla quien hace la petición, así que **no se confía
 * en ella para nada sensible**: solo se usa para construir el enlace del QR, el
 * texto de la página y el diagnóstico de `/health`. No interviene en
 * autenticación, redirecciones, cookies ni CORS. Cualquiera que pueda falsificarla
 * ya puede pedir un código de emparejamiento por otra vía.
 */

/** `true` si la dirección solo existe dentro de la máquina. */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value) return false;

  // Tres formas: `host`, `host:puerto` e IPv6 (`::1`, `[::1]:6768`). Separar el
  // puerto a ciegas por el último `:` rompe con IPv6 sin corchetes.
  const bracketed = /^\[([^\]]+)\]/.exec(value);

  let name: string;
  if (bracketed) {
    name = bracketed[1] ?? '';
  } else if (/^[^:]+$/.test(value)) {
    name = value;
  } else if (/^[^:]+:\d+$/.test(value)) {
    name = value.slice(0, value.lastIndexOf(':'));
  } else {
    // IPv6 sin corchetes: no hay puerto que separar.
    name = value;
  }

  // Un punto final es legal en una dirección (`localhost.`) y sigue siendo el mismo sitio.
  name = name.replace(/\.$/, '');

  return name === 'localhost' || name === '::1' || /^127\./.test(name);
}

/** `true` si la cadena puede usarse como origen en una URL. */
export function isValidOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface OriginInput {
  /** Cabecera `Host` de la petición entrante. */
  host?: string | undefined;
  /** Cabecera `X-Forwarded-Proto`, si hay un proxy delante. */
  forwardedProto?: string | undefined;
  /** Puerto del listener, como último recurso. */
  fallbackPort: number;
  /** Anulación explícita por configuración. */
  configured?: string | undefined;
}

/**
 * Construye el origen público. **Nunca lanza**: una entrada rara cae al listener.
 *
 * Esto importa: un `Host` inválido llegaba hasta `new URL()` dentro del manejador
 * de `/pair`, que lanzaba sin respuesta y tumbaba la petición. La cabecera la
 * controla el cliente, así que aquí no puede haber excepciones.
 */
export function publicOriginFor(input: OriginInput): string {
  const fallback = `http://127.0.0.1:${input.fallbackPort}`;

  const configured = input.configured?.trim().replace(/\/+$/, '');
  if (configured) return isValidOrigin(configured) ? configured : fallback;

  const host = input.host?.trim();
  if (!host) return fallback;

  // Un `Host` legítimo es `nombre[:puerto]`: nada de rutas, credenciales ni
  // esquemas embebidos. Sin esto, `https://http://` parsea como URL válida.
  if (/[\s/?#@\\]/.test(host)) return fallback;
  if ([...host].some((character) => character.charCodeAt(0) < 0x20)) return fallback;
  if (host.length > 255) return fallback;

  const forwarded = input.forwardedProto?.split(',')[0]?.trim().toLowerCase();
  const scheme =
    forwarded === 'https' || forwarded === 'http'
      ? forwarded
      : isLoopbackHost(host)
        ? 'http'
        : 'https';

  const candidate = `${scheme}://${host}`;
  return isValidOrigin(candidate) ? candidate : fallback;
}

export type NoticeSeverity = 'blocking' | 'warning';

export interface OriginNotice {
  severity: NoticeSeverity;
  message: string;
}

/**
 * Aviso para la página de emparejamiento, o `undefined` si el destino sirve.
 *
 * Distingue dos casos que antes se mezclaban y se contradecían entre sí:
 *
 * - **blocking**: el enlace no lleva a ninguna parte desde el teléfono.
 * - **warning**: el enlace funciona, pero el navegador no dejará instalar la app.
 */
export function originNotice(origin: string): OriginNotice | undefined {
  if (!isValidOrigin(origin)) {
    return {
      severity: 'blocking',
      message: `The public address "${origin}" is not valid.`,
    };
  }

  const parsed = new URL(origin);

  if (isLoopbackHost(parsed.host)) {
    return {
      severity: 'blocking',
      message:
        `${parsed.host} only exists inside this PC: on a phone it points at the phone ` +
        'itself. Open this page through the tailnet address (tailscale serve) or ' +
        'configura DSH_MOBILE_PUBLIC_URL.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      severity: 'warning',
      message:
        'This address is plain HTTP. The app will load, but the browser will not ' +
        'instalarse ni usar notificaciones: eso exige HTTPS, que es lo que da el nombre ' +
        'del tailnet.',
    };
  }

  return undefined;
}

/** Texto del cartel para la página de emparejamiento. */
export function noticeHeadline(notice: OriginNotice): string {
  return notice.severity === 'blocking'
    ? 'This QR will not work from a phone.'
    : 'It will work, but you will not be able to install it.';
}
