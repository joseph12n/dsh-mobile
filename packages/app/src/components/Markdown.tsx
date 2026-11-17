import { useEffect, useRef } from 'react';
import { linkHit, sanitizeMarkdown } from '../lib/markdown.js';
import { workspacePathOf } from '../lib/workspace-path.js';
import { findFilePaths } from '../lib/files.js';
import { FileIcon } from './FileIcons.js';

export function Markdown({
  text,
  onOpenFile,
}: Readonly<{ text: string; onOpenFile?: (path: string) => void }>) {
  const area = useRef<HTMLDivElement>(null);
  const open = useRef(onOpenFile);
  const html = sanitizeMarkdown(text);

  useEffect(() => {
    open.current = onOpenFile;
  }, [onOpenFile]);

  useEffect(() => {
    const node = area.current;
    if (!node) return;

    const onClick = (event: MouseEvent): void => {
      const link = linkHit(event.target);
      if (!link || link.external) return;

      event.preventDefault();
      const path = workspacePathOf(link.href);
      if (path) open.current?.(path);
    };

    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, []);

  return <div ref={area} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function FileCards({
  paths,
  onOpenFile,
}: Readonly<{
  paths: string[];
  onOpenFile?: (path: string) => void;
}>) {
  if (!onOpenFile || paths.length === 0) return null;

  return (
    <div className="file-cards">
      {paths.map((path) => (
        <button
          key={path}
          type="button"
          className="file-card"
          onClick={() => onOpenFile(path)}
          title={path}
        >
          <span className="file-card-icon">
            <FileIcon path={path} />
          </span>
          <span className="file-card-name">{path}</span>
        </button>
      ))}
    </div>
  );
}

export function MessageBody({
  text,
  onOpenFile,
}: Readonly<{
  text: string;
  onOpenFile?: (path: string) => void;
}>) {
  const paths = onOpenFile ? findFilePaths(text) : [];
  return (
    <>
      <Markdown text={text} {...(onOpenFile ? { onOpenFile } : {})} />
      <FileCards paths={paths} {...(onOpenFile ? { onOpenFile } : {})} />
    </>
  );
}
