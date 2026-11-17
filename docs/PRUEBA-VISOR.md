# Prueba del visor

Este archivo existe para comprobar cómo se lee un `.md` real en la PWA.

## Qué debe verse

- **Negritas**, _cursivas_ y `código en línea`.
- Una lista numerada:
  1. La card con su icono.
  2. El visor con títulos, tablas y bloques.
- Un enlace: [README](../README.md).

### Tabla de comprobación

| Caso   | Esperado         |
| ------ | ---------------- |
| Card   | icono + ruta     |
| Visor  | Markdown saneado |
| Volver | regresa al turno |

```ts
const file = await connection.fileStat(sessionId, 'docs/PRUEBA-VISOR.md');
```

> Una cita para comprobar el estilo del borde.

También menciono `docs/screenshots.md` y `README.md` para ver varias cards en el mismo mensaje.
