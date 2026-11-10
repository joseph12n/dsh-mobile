import { z } from 'zod';
import { PROTOCOL_VERSION } from './version.js';

/**
 * Campos que lleva todo mensaje, en las dos direcciones.
 *
 * `id` correlaciona: en una petición lo elige el cliente y el host responde con
 * el mismo valor. En un envío del host lo genera el host.
 */
export const Envelope = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
});

export type Envelope = z.infer<typeof Envelope>;

/** Campos del sobre sin `type`, para componer cada mensaje. */
export const envelopeFields = {
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  at: z.number().int().nonnegative(),
} as const;
