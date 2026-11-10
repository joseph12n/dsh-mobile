# DSH Mobile

Cliente móvil (**PWA** instalable) + plugin host para **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**.

Controla tus sesiones desde el teléfono: mira el estado, lee la transcripción, responde,
aprueba preguntas y lanza o cancela ejecuciones. El PC sigue siendo el que ejecuta todo;
el móvil es un control remoto, no un segundo agente.

> **Estado: fase 2 en curso.** El emparejamiento por QR, los tokens de dispositivo, el
> listado de sesiones y la PWA que los consume funcionan y están probados. Falta la
> transcripción y el puente de preguntas.

---

## Cómo funciona

```
PC (ejecuta DSH)                                  Teléfono
┌──────────────────────────────────────┐   ┌──────────────────────────┐
│ plugin @dsh-mobile/companion         │   │ PWA @dsh-mobile/app      │
│  · listener propio :6768             │◄─►│  · emparejamiento        │
│  · sirve la PWA compilada            │WS │  · sesiones y estado     │
│  · emparejamiento por QR             │   │  · transcripción         │
│  · token por dispositivo             │   │  · preguntas y respuestas│
│  · puente a los servicios de DSH     │   │  · composer              │
└──────────────────────────────────────┘   └──────────────────────────┘
```

El plugin corre **dentro** del proceso de DSH, así que ve las sesiones sin forkear el
núcleo y sin romperse con las actualizaciones del upstream.

**La frontera es el contrato.** El móvil nunca habla con las tripas de DSH: habla
`dsh-mobile/1`, un protocolo propio y versionado. Solo el plugin conoce DSH. Si upstream
cambia, se toca un adaptador y el cliente no se entera.

**Un solo artefacto.** El plugin sirve la PWA compilada, así que host y cliente no pueden
desincronizarse: son la misma versión por construcción.

### Emparejamiento

El escritorio muestra un **QR** que no es un código suelto, sino un **enlace directo**:

```
https://<host>/#/pair?v=1&c=<código>&e=<endpoint>
```

Un solo escaneo resuelve _a dónde_ conectarse y _quién_ eres. El código va en el fragmento
de la URL, así que no viaja al servidor ni queda en logs. Caduca a los 10 minutos, es de
un solo uso y el canje crea un **token de dispositivo** guardado en hash.

Cambiar de red (LAN ↔ tailnet) se hace editando el endpoint, **sin re-emparejar**.

---

## Paquetes

| Paquete                                       | Qué es                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| [`@dsh-mobile/protocol`](packages/protocol)   | Contrato: esquemas Zod, tipos y constantes. Isomorfo        |
| [`@dsh-mobile/companion`](packages/companion) | Plugin host: listener, emparejamiento, PWA, adaptador a DSH |
| [`@dsh-mobile/app`](packages/app)             | PWA: React + Vite                                           |

El contrato exige **TypeScript** en todo el repo: un esquema, dos consumidores, y un
cambio incompatible rompe el build en vez de al usuario.

---

## Requisitos

- **Node.js 24** (el plugin corre en el Node que embebe DSH; se desarrolla con la misma
  versión para no usar APIs que el host no tiene).
- **pnpm 12**.
- DeepSeek Harness instalado en el PC.

## Desarrollo

```bash
pnpm install
pnpm build        # protocol → companion → app (orden topológico)
pnpm test         # vitest
pnpm smoke        # arranca el servidor compilado y comprueba PWA + emparejamiento
pnpm typecheck
pnpm lint
pnpm dev          # PWA en http://127.0.0.1:5173
```

`pnpm smoke` es la comprobación de que **el paquete que se publicaría** funciona: levanta
el servidor de `dist/` sirviendo la PWA de `dist/` en un puerto efímero y recorre
emparejamiento y listado de sesiones.

## Uso del plugin

Enlázalo desde tu perfil de DSH (`~/.dsh/profiles/<perfil>/package.json`):

```json
{
  "dsh": { "profile": { "bundles": ["@dsh-mobile/companion"] } },
  "dependencies": { "@dsh-mobile/companion": "link:/ruta/a/dsh-mobile/packages/companion" }
}
```

El plugin escucha en `127.0.0.1:6768` y expone:

| Ruta          | Qué hace                                                 |
| ------------- | -------------------------------------------------------- |
| `GET /`       | La PWA instalable                                        |
| `GET /pair`   | QR de emparejamiento y código en texto                   |
| `GET /health` | Estado, versión de protocolo, capacidades y dispositivos |
| `WS /ws`      | El contrato `dsh-mobile/1`                               |

Variables de entorno: `DSH_MOBILE_PORT`, `DSH_MOBILE_PUBLIC_URL`, `DSH_MOBILE_WEB_ROOT`.

---

## Seguridad

- **Loopback por defecto.** El listener no se expone a la red hasta que existe
  autenticación por dispositivo.
- **Nunca a internet sin autenticación sólida.** Esto es un cliente que puede ejecutar
  acciones en tu máquina. LAN y tailnet primero.
- **Token por dispositivo, guardado en hash.** Revocar uno no afecta a los demás.
- **El host decide.** El cliente no oculta por CSS lo que no puede hacer: el servidor no
  lo envía.
- **Alcance acotado.** El móvil no cambia ajustes, credenciales ni plugins.

Para usarlo fuera de casa se recomienda **Tailscale**, sirviendo la PWA por HTTPS en el
nombre del tailnet: contexto seguro, certificado propio y una sola URL para casa y para
la calle.

---

## Documentación

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — cómo trabajar en el repo.
- [`packages/protocol/src/messages.ts`](packages/protocol/src/messages.ts) — el contrato,
  como código y como fuente de verdad.

## Licencia

[MIT](LICENSE).
