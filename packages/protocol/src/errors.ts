import { z } from 'zod';

/**
 * Códigos de error estables. Son parte del contrato: un cliente puede
 * ramificar sobre ellos sin mirar el texto.
 */
export const ErrorCode = z.enum([
  /** Hay que mandar `hello` antes de cualquier otra cosa. */
  'auth-required',
  /** El token de dispositivo no existe, fue revocado o está mal. */
  'auth-invalid',
  /** La versión de protocolo pedida no está soportada por este host. */
  'proto-unsupported',
  /** El recurso (sesión, pregunta) no existe o ya no está disponible. */
  'not-found',
  /** El dispositivo está autenticado pero no puede hacer esto. */
  'denied',
  /** Demasiados marcos por minuto. */
  'rate-limited',
  /** La petición no valida contra el esquema. */
  'bad-request',
  /** Fallo interno del host. No expone detalles al cliente. */
  'internal',
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

export const RemoteError = z.object({
  code: ErrorCode,
  message: z.string(),
  /** `id` del mensaje que provocó el error, si lo hubo. */
  requestId: z.string().optional(),
});

export type RemoteError = z.infer<typeof RemoteError>;
