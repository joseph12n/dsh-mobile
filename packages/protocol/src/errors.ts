import { z } from 'zod';

export const ErrorCode = z.enum([
  'auth-required',
  'auth-invalid',
  'proto-unsupported',
  'not-found',
  'denied',
  'rate-limited',
  'bad-request',
  'internal',
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

export const RemoteError = z.object({
  code: ErrorCode,
  message: z.string(),
  requestId: z.string().optional(),
});

export type RemoteError = z.infer<typeof RemoteError>;
