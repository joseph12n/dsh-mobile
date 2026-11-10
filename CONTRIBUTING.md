# Contribuir

Gracias por el interés. Esto es un proyecto pequeño y experimental; la prioridad es que
el código sea fácil de razonar y que la frontera con DeepSeek Harness se mantenga limpia.

## Antes de empezar

Lee el [README](README.md) para entender la forma del sistema. La idea que ordena todo el
diseño:

> El móvil habla **un contrato propio**. Solo el plugin conoce las tripas de DSH.

Si una propuesta hace que la PWA dependa de detalles internos de DSH, va en dirección
contraria al proyecto.

## Entorno

- Node.js **24** (el plugin se ejecuta en el Node que embebe DSH).
- pnpm **12**.

```bash
pnpm install
pnpm build
pnpm test
```

## Comandos

| Comando          | Qué hace                                      |
| ---------------- | --------------------------------------------- |
| `pnpm build`     | Compila los tres paquetes en orden topológico |
| `pnpm test`      | Vitest, toda la suite                         |
| `pnpm typecheck` | `tsc --noEmit` por paquete                    |
| `pnpm lint`      | ESLint                                        |
| `pnpm format`    | Prettier                                      |
| `pnpm dev`       | PWA en modo desarrollo                        |

Antes de proponer un cambio, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` debe
pasar en limpio.

## Estructura

```
packages/
  protocol/    contrato: esquemas Zod + tipos + constantes
  companion/   plugin host
    src/core/    dominio puro (sin DSH, sin I/O)
    src/dsh/     ÚNICO lugar que conoce DSH
    src/net/     WebSocket y autenticación
  app/         PWA (React + Vite)
```

### Reglas de capas

1. **`core` no importa nada de `@deepseek-ai/*` ni toca disco ni red.** Dominio puro: se
   prueba con datos en memoria.
2. **Solo `dsh` conoce DSH.** Todo el acoplamiento con el host vive ahí, detrás de
   interfaces declaradas en `core`.
3. **`net` no conoce el dominio.** Serializa el contrato y nada más.
4. **`app` no conoce DSH.** Solo `@dsh-mobile/protocol`.

Romper la regla 2 es la forma más rápida de que una actualización de DSH nos rompa el
proyecto.

## El contrato

`packages/protocol` es la **fuente única de verdad**. Los esquemas Zod generan los tipos.

- Un mensaje nuevo entra en `messages.ts` como unión discriminada por `type`.
- Todo mensaje lleva el sobre `{ v, id, at, type }`.
- Las respuestas reutilizan el `id` de la petición.
- Cambio incompatible ⇒ subir `PROTOCOL_VERSION` y ajustar `SUPPORTED_PROTOCOL_VERSIONS`.
  Un host viejo debe **rechazar** al cliente nuevo con `proto-unsupported`, nunca fallar
  de forma rara.
- Los errores usan los códigos de `errors.ts`. No inventes códigos ad hoc: un cliente
  ramifica sobre ellos.

Cada mensaje nuevo necesita su prueba de validación en `protocol.test.ts`.

## Estilo

- **TypeScript estricto.** Nada de `any` sin justificar.
- **ESM.** Imports relativos con extensión `.js`.
- Comentarios en español; identificadores en inglés.
- Prettier manda en el formato; no discutas el formato en un PR.

## Pruebas

- Unitarias: lógica de dominio, validación del contrato.
- Integración: el listener con un cliente WebSocket real (`server.test.ts` lo hace con un
  puerto efímero).

No se acepta una funcionalidad "probada solo en el emulador del navegador": lo que toca el
móvil se prueba en un teléfono.

## Commits y PR

- Un cambio lógico por commit; mensaje en imperativo y en español
  (`añade emparejamiento por QR`, no `añadido`).
- Un PR que cambie el contrato debe explicar la compatibilidad.
- Si algo **no** está verificado, dilo en el PR. Se prefiere un "no lo he probado" a una
  afirmación por intuición.

## Seguridad

Un fallo de seguridad en esto es serio: el cliente puede ejecutar acciones en la máquina
del usuario.

- Nada de secretos en el repositorio. Nada de tokens en logs.
- Los tokens de dispositivo se guardan **hasheados**.
- Los códigos de emparejamiento son de un solo uso y caducan.
- No se expone el host a internet sin autenticación sólida.
- Si encuentras una vulnerabilidad, **no abras un issue público**: escríbelo en privado a
  quien mantiene el repo.
