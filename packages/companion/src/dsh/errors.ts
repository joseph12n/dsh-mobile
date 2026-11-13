interface CodedError {
  code?: unknown;
  message?: unknown;
}

export function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as CodedError;
  return typeof code === 'string' ? code : undefined;
}

export function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { message } = error as CodedError;
    if (typeof message === 'string') return message;
  }
  return String(error);
}
