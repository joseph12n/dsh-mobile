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

Una PWA necesita **Service Worker**, y el Service Worker exige **contexto seguro**:
`https://` o `localhost`. Sobre `http://100.x.y.z` el navegador no lo registra: no hay
instalación, ni caché offline, ni notificaciones.

Con `tailscale serve` el certificado lo gestiona Tailscale. No hace falta dominio ni abrir
puertos.

## Paso a paso

### 1. En el PC

Instala Tailscale y entra a tu tailnet. Luego publica el plugin:

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:6768
```

`--bg` deja la configuración guardada: sobrevive a reinicios.

Comprueba que responde **desde la dirección del tailnet**, no desde localhost:

```powershell
curl https://<maquina>.<tailnet>.ts.net/health
```

La respuesta trae `origin` y, si algo va mal, un `warning`. Si aparece un aviso, es que
estás entrando por una dirección que el teléfono no va a poder usar.

### 2. En el teléfono

1. Instala **Tailscale** desde la tienda de tu sistema y entra con **la misma cuenta**.
2. Comprueba que aparece el PC en la lista de dispositivos.
3. Abre `https://<maquina>.<tailnet>.ts.net/pair` **desde el navegador del teléfono**.
   - Si lo abres desde el PC, el QR puede apuntar a `localhost`, que en el teléfono es el
     propio teléfono. La página avisa cuando eso pasa.
4. Escanea el QR con la cámara y sigue el enlace.

### 3. Instalar la app

Con la página abierta y en HTTPS, el navegador ofrece **"Añadir a pantalla de inicio"**. Ahí
queda como aplicación, a pantalla completa y con su icono.

## Problemas típicos

| Síntoma                          | Causa                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| "Conexión rechazada" al escanear | El QR apunta a `127.0.0.1`. Ábrelo desde la dirección del tailnet |
| El teléfono no ve el PC          | Falta instalar Tailscale en el teléfono o entrar con otra cuenta  |
| Carga pero no se puede instalar  | Estás en HTTP, no HTTPS. Hace falta el nombre del tailnet         |
| `warning` en `/health`           | La dirección con la que entras no sirve para el teléfono          |

## Si quieres forzar la dirección

Cuando hay un proxy que no propaga el `Host` original, puedes fijar la dirección pública:

```powershell
$env:DSH_MOBILE_PUBLIC_URL = "https://<maquina>.<tailnet>.ts.net"
```

Tiene prioridad sobre la deducción automática. Conviene dejarla puesta si el QR sale mal.

## Fuera de alcance

- **LAN directa**: el plugin no escucha fuera del loopback, así que no funciona. Sería un
  cambio de código, no de configuración.
- **Internet abierto**: no lo hagas. Esto es un cliente que puede ejecutar acciones en tu
  máquina. Tailscale mantiene la red privada; abrir el puerto a internet no.
