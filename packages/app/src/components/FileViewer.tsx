import { useEffect, useRef, useState } from 'react';
import type { FileInfo } from '@deepseekharness-mobile/protocol';
import { useI18n } from '../i18n/index.js';
import { linkHit, sanitizeMarkdown } from '../lib/markdown.js';
import { resolveWorkspacePath } from '../lib/workspace-path.js';

type TextPage = { text: string; offset: number; eof: boolean; nextOffset?: number };
type BytesPage = { mime: string; data: string };

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
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const linkTarget = useRef({ path, onOpenPath });

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
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
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
            {error}
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
        {!loading && !error && file?.kind === 'pdf' && bytes && (
          <embed
            className="file-pdf"
            type="application/pdf"
            src={`data:${bytes.mime};base64,${bytes.data}`}
          />
        )}
        {!loading && !error && file?.kind === 'office' && bytes && (
          <embed
            className="file-pdf"
            type="application/pdf"
            src={`data:${bytes.mime};base64,${bytes.data}`}
          />
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
