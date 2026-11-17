import { linkHit, sanitizeMarkdown, workspacePathOf } from '../lib/markdown.js';
import { findFilePaths } from '../lib/files.js';
import { FileIcon } from './FileIcons.js';

export function Markdown({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile?: (path: string) => void;
}) {
  const html = sanitizeMarkdown(text);

  return (
    <div
      className="markdown"
      onClick={(event) => {
        const link = linkHit(event.target);
        if (!link) return;
        if (link.external) return;

        event.preventDefault();
        if (!onOpenFile) return;
        const path = workspacePathOf(link.href);
        if (path) onOpenFile(path);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function FileCards({
  paths,
  onOpenFile,
}: {
  paths: string[];
  onOpenFile?: (path: string) => void;
}) {
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
}: {
  text: string;
  onOpenFile?: (path: string) => void;
}) {
  const paths = onOpenFile ? findFilePaths(text) : [];
  return (
    <>
      <Markdown text={text} {...(onOpenFile ? { onOpenFile } : {})} />
      <FileCards paths={paths} {...(onOpenFile ? { onOpenFile } : {})} />
    </>
  );
}
