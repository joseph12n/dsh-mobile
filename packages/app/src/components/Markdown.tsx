import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { findFilePaths } from '../lib/files.js';
import { FileIcon } from './FileIcons.js';

export function Markdown({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parse(text) as string, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  });

  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
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
      <Markdown text={text} />
      <FileCards paths={paths} {...(onOpenFile ? { onOpenFile } : {})} />
    </>
  );
}
