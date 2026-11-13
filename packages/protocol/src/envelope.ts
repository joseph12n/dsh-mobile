import { z } from 'zod';
import { PROTOCOL_VERSION } from './version.js';

export const Envelope = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
});

export type Envelope = z.infer<typeof Envelope>;

export const envelopeFields = {
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
} as const;
