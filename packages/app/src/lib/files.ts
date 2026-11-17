import type { FileKind } from '@deepseekharness-mobile/protocol';

export function fileKindOf(path: string): FileKind {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(extension)) return 'image';
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extension)) return 'office';
  if (
    [
      '.txt',
      '.log',
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.css',
      '.html',
      '.sh',
      '.ps1',
      '.py',
      '.rs',
      '.go',
      '.sql',
      '.csv',
    ].includes(extension)
  )
    return 'text';
  return 'other';
}

const FILE_PATTERN =
  /((?:[\w.-]+\/)*[\w.-]+\.(?:md|markdown|txt|json|ya?ml|toml|tsx?|jsx?|mjs|css|html|sh|ps1|py|rs|go|sql|csv|pdf|png|jpe?g|webp|gif|avif|docx?|xlsx?|pptx?))/gi;

export function findFilePaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(FILE_PATTERN)) {
    const path = match[1];
    if (path) paths.add(path);
  }
  return [...paths];
}
