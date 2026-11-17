import DOMPurify from 'dompurify';
import { marked } from 'marked';

const FORBID_TAGS = ['style', 'form', 'input', 'button', 'img', 'iframe', 'object', 'embed'];
const FORBID_ATTR = ['style'];

let hooked = false;

function hardenLinks(): void {
  if (hooked) return;
  hooked = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') return;
    const href = node.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function sanitizeMarkdown(text: string): string {
  hardenLinks();
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
  });
}

export interface LinkHit {
  href: string;
  external: boolean;
}

export function linkHit(target: EventTarget | null): LinkHit | undefined {
  if (!(target instanceof Element)) return undefined;
  const anchor = target.closest('a');
  if (!anchor) return undefined;
  const href = anchor.getAttribute('href') ?? '';
  return { href, external: /^https?:\/\//i.test(href) };
}
