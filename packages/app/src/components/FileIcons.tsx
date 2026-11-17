import type { FileKind } from '@deepseekharness-mobile/protocol';
import { fileKindOf } from '../lib/files.js';

export function FileIcon({ path, kind }: { path: string; kind?: FileKind }) {
  const resolved = kind ?? fileKindOf(path);
  if (resolved === 'image') {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
        <circle cx="6" cy="6.5" r="1.3" fill="currentColor" />
        <path
          d="M3 12l3.5-3.5 2 2L11 8l2 4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (resolved === 'pdf' || resolved === 'office') {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        <path d="M3 2.5h7l3 3v8H3z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        <path d="M10 2.5v3h3" fill="none" stroke="currentColor" strokeLinejoin="round" />
        <path d="M5 11h6M5 8.5h3" stroke="currentColor" strokeLinecap="round" />
      </svg>
    );
  }
  if (resolved === 'markdown') {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        <rect x="1.5" y="3.5" width="13" height="9" rx="2" fill="none" stroke="currentColor" />
        <path
          d="M4 10V6l1.6 2L7.2 6v4M9.5 6v4M9.5 10l1.4-1.6M9.5 10l1.4 1.6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (resolved === 'text') {
    return (
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        <path
          d="M4 2.5h6l2.5 2.5v8.5H4z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
        />
        <path d="M6 8h4M6 10.5h4" stroke="currentColor" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M4 2.5h6l2.5 2.5v8.5H4z" fill="none" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

export function ToolIcon({ name }: { name: string }) {
  const tool = name.toLowerCase();
  if (/bash|shell|terminal|exec/.test(tool)) {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
        <path
          d="M4 6l2 2-2 2M8.5 10h3.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (/read|glob|grep|search|find/.test(tool)) {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" />
        <path d="M10.2 10.2L14 14" stroke="currentColor" strokeLinecap="round" />
      </svg>
    );
  }
  if (/write|edit|apply|patch/.test(tool)) {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path
          d="M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
        />
        <path d="M9.5 4l2.5 2.5" stroke="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" />
      <path d="M8 5.5v3l2 1.5" fill="none" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}
