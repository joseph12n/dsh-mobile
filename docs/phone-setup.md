# Usar DSH Mobile desde el teléfono

El plugin escucha **solo en `127.0.0.1`**. Eso significa que el teléfono no puede llegar a
él directamente, ni siquiera en la misma red: no es un problema de firewall, es que el
socket no existe fuera de la máquina.

La vía soportada es **Tailscale**: hace de fachada TLS hacia el loopback y te da una sola
dirección que funciona en casa y en la calle.

```
Teléfono ──► https://<maquina>.<tailnet>.ts.net ──► tailscale serve ──► 127.0.0.1:6768
```

## Por qué HTTPS y no la IP de la LAN

Una web solo puede **instalarse** como aplicación desde un **contexto seguro**: `https://`
o `localhost`. Sobre `http://100.x.y.z` el navegador la muestra como una página normal,
pero no ofrece instalarla. Con `tailscale serve` el certificado lo gestiona Tailscale y no
hace falta dominio ni abrir puertos.

> La app **todavía no tiene service worker ni notificaciones push**. Eso es trabajo
> pendiente; hoy lo que HTTPS desbloquea es la instalación.

## Requisitos en el tailnet

En la consola de administración de Tailscale (`login.tailscale.com/admin/dns`):

- **MagicDNS** activado.
- **HTTPS Certificates** activado. Sin esto, `tailscale serve --https` no puede emitir el
  certificado y falla.

## Paso a paso

### 1. En el PC

Instala Tailscale y entra a tu tailnet. Luego publica el plugin:

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:6768
```

`--bg` deja la configuración guardada: sobrevive a reinicios.

Comprueba que responde **desde la dirección del tailnet**, no desde localhost:

```powershell
(Invoke-WebRequest https://<maquina>.<tailnet>.ts.net/health -UseBasicParsing).Content
```

La respuesta incluye `origin` y, si esa dirección no sirve para el teléfono, un `warning`
con su gravedad (`blocking` o `warning`).

> No uses `curl` en PowerShell 5.1: ahí es un alias de `Invoke-WebRequest` y no devuelve el
> JSON crudo.

### 2. En el teléfono

1. Instala **Tailscale** desde la tienda de tu sistema y entra con **la misma cuenta**.
2. Comprueba que el PC aparece en la lista de dispositivos.

### 3. Emparejar

El QR se **muestra en el PC** y se **escanea con el teléfono**:

1. Abre `https://<maquina>.<tailnet>.ts.net/pair` **en el navegador del PC**, no en el
   teléfono.
2. Desde la cámara del teléfono, escanea el QR que aparece en la pantalla.

Es al revés de lo que parece: si abres `/pair` en el teléfono, el QR estaría en la propia
pantalla que tienes que escanear.

> Si abres `/pair` en el PC usando `127.0.0.1`, el QR apuntará a `127.0.0.1` y no
> funcionará. La página lo avisa con un cartel rojo cuando eso pasa.

### 4. Instalar la app

1. Abre la dirección del tailnet **en el navegador del teléfono**.
2. Añádela a la pantalla de inicio:
   - **Android (Chrome)**: menú ⋮ → _Añadir a pantalla de inicio_ (o el aviso de instalación).
   - **iOS (Safari)**: botón Compartir → _Añadir a pantalla de inicio_. En iOS es siempre
     manual: no hay aviso automático.

## Problemas típicos

| Síntoma                          | Causa                                                                |
| -------------------------------- | -------------------------------------------------------------------- |
| "Conexión rechazada" al escanear | El QR apunta a `127.0.0.1`: abre `/pair` desde el nombre del tailnet |
| El teléfono no ve el PC          | Falta instalar Tailscale en el teléfono o está con otra cuenta       |
| Carga pero no se puede instalar  | Estás en HTTP, no en HTTPS                                           |
| `tailscale serve --https` falla  | Falta activar _HTTPS Certificates_ en la consola                     |
| El QR sale con aviso rojo        | La dirección desde la que abriste `/pair` no sirve para el teléfono  |

## Si quieres forzar la dirección

Normalmente no hace falta: el plugin usa la dirección por la que entraste.

Si hay un proxy que no propaga el `Host`, puedes fijarla. La variable se lee **una sola vez
al arrancar el plugin**, así que hay que definirla antes de abrir DSH:

```powershell
[Environment]::SetEnvironmentVariable('DSH_MOBILE_PUBLIC_URL', 'https://<maquina>.<tailnet>.ts.net', 'User')
```

Después hay que **reiniciar DSH** para que la recoja. `$env:DSH_MOBILE_PUBLIC_URL = ...` solo
afecta a la sesión actual de PowerShell y no la verá un DSH ya abierto.

## Fuera de alcance

- **LAN directa**: el plugin no escucha fuera del loopback, así que no funciona. Sería un
  cambio de código, no de configuración.
- **Internet abierto**: no lo hagas. Esto es un cliente que puede ejecutar acciones en tu
  máquina. Tailscale mantiene la red privada; abrir el puerto a internet no.
