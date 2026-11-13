export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value) return false;

  const bracketed = /^\[([^\]]+)\]/.exec(value);

  let name: string;
  if (bracketed) {
    name = bracketed[1] ?? '';
  } else if (/^[^:]+$/.test(value)) {
    name = value;
  } else if (/^[^:]+:\d+$/.test(value)) {
    name = value.slice(0, value.lastIndexOf(':'));
  } else {
    name = value;
  }

  name = name.replace(/\.$/, '');

  return name === 'localhost' || name === '::1' || /^127\./.test(name);
}

export function isValidOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface OriginInput {
  host?: string | undefined;
  forwardedProto?: string | undefined;
  fallbackPort: number;
  configured?: string | undefined;
}

export function publicOriginFor(input: OriginInput): string {
  const fallback = `http://127.0.0.1:${input.fallbackPort}`;

  const configured = input.configured?.trim().replace(/\/+$/, '');
  if (configured) return isValidOrigin(configured) ? configured : fallback;

  const host = input.host?.trim();
  if (!host) return fallback;

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
        'set DSH_MOBILE_PUBLIC_URL.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      severity: 'warning',
      message:
        'This address is plain HTTP. The app will load, but the browser will not ' +
        'let you install it or use notifications: both need HTTPS, which the tailnet ' +
        'name provides.',
    };
  }

  return undefined;
}

export function noticeHeadline(notice: OriginNotice): string {
  return notice.severity === 'blocking'
    ? 'This QR will not work from a phone.'
    : 'It will work, but you will not be able to install it.';
}
