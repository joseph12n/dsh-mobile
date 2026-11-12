/**
 * Lectura de los errores del host.
 *
 * DSH marca las negativas con un código estable en `error.code`; el texto no
 * contiene ese código, así que buscar en el mensaje no acierta nunca. Estas dos
 * funciones son el único lugar que asume esa forma, compartido por los
 * adaptadores que traducen negativas a nuestro vocabulario.
 */

/** Un error que lleva un código estable, que es como el host reporta negativas. */
interface CodedError {
  code?: unknown;
  message?: unknown;
}

/** El código estable del error, si lo trae. */
export function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as CodedError;
  return typeof code === 'string' ? code : undefined;
}

/** El texto del error, sin asumir que sea un `Error`. */
export function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { message } = error as CodedError;
    if (typeof message === 'string') return message;
  }
  return String(error);
}
