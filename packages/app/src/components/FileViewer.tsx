import { useEffect, useRef, useState } from 'react';
import type { FileInfo } from '@deepseekharness-mobile/protocol';
import { useI18n } from '../i18n/index.js';
import { linkHit, sanitizeMarkdown } from '../lib/markdown.js';
import { resolveWorkspacePath } from '../lib/workspace-path.js';

type TextPage = { text: string; offset: number; eof: boolean; nextOffset?: number };
type ViewError = { message: string; code?: string };

function errorOf(cause: unknown): ViewError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  return { message, ...(typeof code === 'string' ? { code } : {}) };
}
type BytesPage = { mime: string; data: string };

const MAX_PAGES = 40;
const MAX_PIXEL_RATIO = 2;

function toBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const content = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) content[index] = binary.charCodeAt(index);
  return content;
}

async function renderPages(
  container: HTMLDivElement,
  bytes: Uint8Array<ArrayBuffer>,
  cancelled: () => boolean,
): Promise<() => void> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  if (cancelled()) {
    void task.destroy();
    return () => undefined;
  }

  const width = container.clientWidth > 0 ? container.clientWidth : 320;
  const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const total = Math.min(pdf.numPages, MAX_PAGES);

  for (let number = 1; number <= total; number += 1) {
    if (cancelled()) break;
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width * ratio) / base.width });
    const canvas = document.createElement('canvas');
    canvas.className = 'file-page';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    const context = canvas.getContext('2d');
    if (!context) continue;
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    if (cancelled()) break;
    container.append(canvas);
  }

  return () => {
    void task.destroy();
  };
}

export function FileViewer({
  sessionId,
  path,
  onClose,
  onOpenPath,
  statFile,
  readFile,
  readFileBytes,
}: Readonly<{
  sessionId: string;
  path: string;
  onClose: () => void;
  onOpenPath?: (path: string) => void;
  statFile: (sessionId: string, path: string) => Promise<FileInfo>;
  readFile: (
    sessionId: string,
    path: string,
    offset?: number,
  ) => Promise<{ file: FileInfo; text: string; offset: number; eof: boolean; nextOffset?: number }>;
  readFileBytes: (
    sessionId: string,
    path: string,
  ) => Promise<{ file: FileInfo; mime: string; data: string }>;
}>) {
  const { t } = useI18n();
  const [file, setFile] = useState<FileInfo | undefined>(undefined);
  const [text, setText] = useState('');
  const [page, setPage] = useState<TextPage | undefined>(undefined);
  const [bytes, setBytes] = useState<BytesPage | undefined>(undefined);
  const [error, setError] = useState<ViewError | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [documentUrl, setDocumentUrl] = useState<string | undefined>(undefined);
  const [documentError, setDocumentError] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const linkTarget = useRef({ path, onOpenPath });

  const isDocument = file?.kind === 'pdf' || file?.kind === 'office';

  useEffect(() => {
    const container = pages.current;
    if (!bytes || !isDocument || !container) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;
    setDocumentError(false);
    container.replaceChildren();

    void renderPages(container, toBytes(bytes.data), () => cancelled)
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        dispose = cleanup;
      })
      .catch(() => {
        if (!cancelled) setDocumentError(true);
      });

    return () => {
      cancelled = true;
      dispose?.();
      container.replaceChildren();
    };
  }, [bytes, isDocument]);

  useEffect(() => {
    linkTarget.current = { path, onOpenPath };
  }, [path, onOpenPath]);

  useEffect(() => {
    const node = body.current;
    if (!node) return;

    const onClick = (event: MouseEvent): void => {
      const link = linkHit(event.target);
      if (!link || link.external) return;

      event.preventDefault();
      const current = linkTarget.current;
      const next = resolveWorkspacePath(current.path, link.href);
      if (next) current.onOpenPath?.(next);
    };

    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setFile(undefined);
    setText('');
    setPage(undefined);
    setBytes(undefined);

    void statFile(sessionId, path)
      .then(async (info) => {
        if (cancelled) return;
        setFile(info);
        if (info.kind === 'image' || info.kind === 'pdf' || info.kind === 'office') {
          const loaded = await readFileBytes(sessionId, path);
          if (!cancelled) setBytes({ mime: loaded.mime, data: loaded.data });
        } else if (info.kind === 'text' || info.kind === 'markdown') {
          const loaded = await readFile(sessionId, path);
          if (!cancelled) {
            setText(loaded.text);
            setPage({
              text: loaded.text,
              offset: loaded.offset,
              eof: loaded.eof,
              ...(loaded.nextOffset !== undefined ? { nextOffset: loaded.nextOffset } : {}),
            });
          }
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorOf(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, path, statFile, readFile, readFileBytes]);

  const loadMore = async (): Promise<void> => {
    if (!page || page.eof || page.nextOffset === undefined) return;
    const loaded = await readFile(sessionId, path, page.nextOffset);
    setText((previous) => previous + loaded.text);
    setPage({
      text: text + loaded.text,
      offset: loaded.offset,
      eof: loaded.eof,
      ...(loaded.nextOffset !== undefined ? { nextOffset: loaded.nextOffset } : {}),
    });
  };

  const markdown = file?.kind === 'markdown' ? sanitizeMarkdown(text) : '';

  useEffect(() => {
    if (!bytes) {
      setDocumentUrl(undefined);
      return;
    }

    const url = URL.createObjectURL(new Blob([toBytes(bytes.data)], { type: bytes.mime }));
    setDocumentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes]);

  return (
    <div className="file-viewer" role="dialog" aria-modal="true" aria-label={file?.name ?? path}>
      <header className="file-viewer-head">
        <button type="button" className="ghost" onClick={onClose} aria-label={t('file.close')}>
          ←
        </button>
        <span className="file-viewer-name" title={path}>
          {file?.name ?? path}
        </span>
      </header>

      <div className="file-viewer-body" ref={body}>
        {loading && <p className="muted small">{t('file.loading')}</p>}
        {error && (
          <p className="error" role="alert">
            {error.code === 'not-found' ? t('file.missing') : error.message}
          </p>
        )}

        {!loading && !error && file?.kind === 'markdown' && (
          <article className="markdown" dangerouslySetInnerHTML={{ __html: markdown }} />
        )}
        {!loading && !error && file?.kind === 'text' && <pre className="file-text">{text}</pre>}
        {!loading && !error && file?.kind === 'image' && bytes && (
          <img
            className="file-image"
            src={`data:${bytes.mime};base64,${bytes.data}`}
            alt={file.name}
          />
        )}
        {!loading && !error && isDocument && (
          <>
            <div className="file-pages" ref={pages} />
            {documentUrl && (
              <a className="file-open" href={documentUrl} target="_blank" rel="noopener noreferrer">
                {t('file.open')}
              </a>
            )}
            {documentError && documentUrl && (
              <embed className="file-pdf" type="application/pdf" src={documentUrl} />
            )}
          </>
        )}
        {!loading && !error && file?.kind === 'other' && (
          <p className="muted small">{t('file.unsupported')}</p>
        )}

        {page && !page.eof && (
          <button type="button" className="ghost" onClick={() => void loadMore()}>
            {t('file.more')}
          </button>
        )}
      </div>
    </div>
  );
}
