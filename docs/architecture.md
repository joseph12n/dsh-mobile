# Arquitectura y protocolo

Este documento explica **por qué** el sistema está construido así. Si vas a cambiar algo,
lee primero esta página: la mitad del diseño son las decisiones descartadas.

---

## 1. La forma en una frase

El PC ejecuta DeepSeek Harness y posee las sesiones; el teléfono es un **control remoto**
que habla un **contrato propio y versionado** con un plugin que corre dentro de DSH.

```
PC (ejecuta DSH)                                  Teléfono
┌──────────────────────────────────────┐   ┌──────────────────────────┐
│ plugin @dsh-mobile/companion         │   │ PWA @dsh-mobile/app      │
│  · listener propio :6768             │◄─►│  · emparejamiento        │
│  · sirve la PWA compilada            │WS │  · sesiones y estado     │
│  · emparejamiento por QR             │   │  · transcripción         │
│  · token por dispositivo             │   │  · preguntas             │
│  · adaptador a los servicios de DSH  │   │  · compositor            │
└──────────────────────────────────────┘   └──────────────────────────┘
```

## 2. La frontera es el contrato

El móvil **nunca** habla con las tripas de DSH. Habla `dsh-mobile/1`, definido en
`packages/protocol` con esquemas Zod. Las consecuencias son deliberadas:

- Upstream puede reorganizar sus servicios internos y el cliente **no se entera**: se
  toca `packages/companion/src/dsh/` y ya está.
- Un cambio incompatible rompe el **build**, no al usuario en el teléfono.
- Cualquiera puede escribir otro cliente sin leer el código de DSH.

## 3. Las capas

```
packages/companion/src/
  core/      dominio puro: emparejamiento, dispositivos. Sin DSH, sin I/O
  dsh/       ÚNICO lugar que conoce DSH. Un archivo por preocupación
  net/       nada: el servidor vive en server.ts y no conoce el dominio
  routes/    sirvido de la PWA compilada
```

Las reglas que no se rompen:

1. **`core/` no importa `@deepseek-ai/*`** ni toca disco ni red. Se prueba con datos en
   memoria y reloj inyectado.
2. **Solo `dsh/` conoce DSH.** Es el parachoques: cuando upstream cambia, el daño está
   acotado a esa carpeta.
3. **`app/` no conoce DSH.** Solo `@dsh-mobile/protocol`.

Romper la regla 2 es la forma más rápida de que una actualización de DSH rompa el proyecto.

## 4. Un solo artefacto

El plugin sirve la PWA compilada. Eso significa que **host y cliente son la misma versión
por construcción**: no existe el escenario "el móvil tiene una app vieja contra un plugin
nuevo".

## 5. Cómo se accede a los servicios de DSH

Regla aprendida a golpes: **nada de lo que no esté en `inject` se lee por propiedad**.

```ts
ctx.sessions; // funciona: está declarado en inject
ctx.get('sessionController'); // funciona: proxy de reflexión
ctx.reflect.store; // se indexa por SÍMBOLOS, no por cadenas
```

Si algo aparece como `undefined`, casi siempre es esto.

## 6. Decisiones descartadas, y por qué

| Opción                                  | Motivo del descarte                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Reutilizar `dsh-experimental-liveshare` | Sirve la **UI de escritorio** a un teléfono — lo contrario del objetivo — y exige un Relay con OAuth            |
| Proxear la UI web                       | El token lo inyecta Electron y no es recuperable desde fuera                                                    |
| Cliente sobre el API Gateway interno    | Protocolo `rc` atado al escritorio; cambia sin avisar                                                           |
| Sidecar en Go/Rust                      | Segundo runtime, IPC propio y doble autenticación, para hablar con un proceso Node que ya nos da acceso directo |

La lección de LiveShare que **sí** se adoptó: _CSS no es autorización_. El servidor no
envía lo que el cliente no puede hacer.

## 7. El protocolo

Transporte: **WebSocket**, mensajes JSON, sobre común `{ v, id, at, type }`.

- **`hello` primero.** Sin él, cualquier otra petición se rechaza con `auth-required`.
- **El `id` correlaciona.** La respuesta repite el `id` de la petición.
- **Los errores tienen código estable** (`errors.ts`). Un cliente ramifica sobre el código,
  nunca sobre el texto.
- **Los mensajes del host sin petición** son envíos espontáneos: `question.pending`,
  `question.settled`, `session.event`.
- Versión desconocida ⇒ `proto-unsupported` con las capacidades del host, nunca un fallo
  raro.

### Mensajes

| Cliente → Host      | Host → Cliente                       |
| ------------------- | ------------------------------------ |
| `hello`             | `hello.ok` / `error`                 |
| `pair.redeem`       | `pair.ok`                            |
| `sessions.list`     | `sessions.ok` (+ `question.pending`) |
| `session.history`   | `history.ok`                         |
| `session.subscribe` | `session.ok` (+ `session.event`)     |
| `reply.send`        | `reply.ok`                           |
| `question.answer`   | `answer.ok`                          |
| `run.cancel`        | `run.ok`                             |
| `ping`              | `pong`                               |

## 8. Emparejamiento

El QR no lleva un código suelto, sino un **enlace directo**:

```
https://<host>/#/pair?v=1&c=<código>&e=<endpoint>
```

- El código viaja en el **fragmento**, así que no se manda al servidor ni queda en logs.
- **128 bits** en base32 Crockford (sin `I`, `L`, `O` ni `U`, para que nadie confunda
  caracteres al teclearlo).
- **Un solo uso, 10 minutos.** El intento distingue _caducado_, _ya usado_ y _no existe_:
  es el mensaje que de verdad ayuda.
- El canje crea un **token de dispositivo** de 32 bytes que se entrega **una vez**. En
  disco solo queda su **SHA-256**, comparado en tiempo constante.

El token es del dispositivo, no de la red: **el protocolo no ata la conexión a una dirección**.

Dicho eso, con honestidad: **la app todavía no ofrece cambiar el endpoint**. Hoy, para
apuntar a otra dirección hay que volver a emparejar. Que el token no esté atado a la red es
una propiedad del diseño, no una función disponible. El ajuste está en el issue #22.

Y hoy el plugin escucha **solo en loopback**, así que la LAN directa no funciona. Se publica
por el nombre del tailnet con `tailscale serve`, que sí llega al loopback y además aporta
HTTPS.

## 9. Preguntas: el lote es la unidad

DSH agrupa las preguntas de una llamada a `ask_user_question` y **valida la respuesta por
lote**: cada pregunta debe aparecer exactamente una vez. Por eso el contrato modela
`QuestionBatch`, no preguntas sueltas.

`selected: []` sin `custom` significa **omitida**, y es una respuesta legítima — distinta de
no responder. Responder requiere el **agente raíz vivo** de la sesión; si no lo está, el
host responde `not-found` diciéndolo.

## 10. Transcripción

- **Historial**: `sessionController.page()` devuelve una página del registro.
- **En vivo**: `observeEvent()` entrega un flujo de eventos según se confirman.
- La traducción es **tolerante a propósito**: se reconocen los eventos que el móvil sabe
  pintar y el resto se descarta. Inventar un renglón es peor que dejar un hueco.
- El cliente fusiona ambas fuentes por `seq`, así que reconectar no duplica.

## 11. Seguridad

- **Loopback por defecto.** El listener se enlaza a `127.0.0.1` y no acepta conexiones
  directas desde la LAN. Se publica por el nombre del tailnet con `tailscale serve`, porque
  la autenticación por dispositivo ya existe y no se quiere un puerto abierto.
- **Token por dispositivo**, guardado en hash; revocar uno no afecta a los demás.
- **Alcance acotado**: sesiones, preguntas y ejecuciones. Nada de ajustes, credenciales ni
  gestión de plugins.
- **El host decide.** Las capacidades se anuncian en `hello.ok` y el servidor no envía lo
  que el cliente no puede hacer.

## 12. Estado

Fases 0 y 1 cerradas con evidencia; fase 2 funcional de punta a punta: emparejar, listar
sesiones, leer transcripción, responder preguntas, escribir y cancelar.

Las tareas pendientes están como issues en GitHub.
