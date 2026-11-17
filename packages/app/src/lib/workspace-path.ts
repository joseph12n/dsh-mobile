export function workspacePathOf(href: string): string | undefined {
  if (href.length === 0 || href.startsWith('#') || href.startsWith('//')) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return undefined;

  let decoded: string;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    return undefined;
  }

  const cut = decoded.split('#')[0]?.split('?')[0] ?? '';
  const path = cut.replace(/^\.\//, '').replace(/\\/g, '/');
  return path.length > 0 ? path : undefined;
}

export function resolveWorkspacePath(fromPath: string, href: string): string | undefined {
  const requested = workspacePathOf(href);
  if (!requested) return undefined;

  const segments = fromPath.split('/').slice(0, -1);
  for (const part of requested.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  return segments.length > 0 ? segments.join('/') : undefined;
}
