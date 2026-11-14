# Using DSH Mobile from your phone

The plugin listens **on `127.0.0.1` only**. That means the phone cannot reach it directly,
not even on the same network: it is not a firewall problem, the socket simply does not exist
outside the machine.

The supported path is **Tailscale**: it acts as a TLS façade in front of loopback and gives
you one address that works at home and on the street.

```
Phone ──► https://<machine>.<tailnet>.ts.net ──► tailscale serve ──► 127.0.0.1:6768
```

## Why HTTPS and not the LAN IP

A web page can only be **installed** as an application from a **secure context**: `https://`
or `localhost`. That is why this setup does not serve the app over plain HTTP: with
`tailscale serve --https` the only address that exists is HTTPS. If it were ever served over
HTTP, the browser would show the app as an ordinary page and would not offer to install it.
With `tailscale serve`, Tailscale manages the certificate: no domain to buy and no ports to
open.

> The app **has no service worker and no push notifications yet**. That is pending work; what
> HTTPS unlocks today is installation.

## Requirements in the tailnet

In the Tailscale admin console (`login.tailscale.com/admin/dns`):

- **MagicDNS** enabled.
- **HTTPS Certificates** enabled. Without it, `tailscale serve --https` cannot issue the
  certificate and fails.

## Step by step

### 0. Before anything else

**DSH has to be running.** The plugin lives inside its process: if DSH is closed, nothing is
listening on the port and both the health check and the app fail.

This guide uses `<machine>.<tailnet>.ts.net` as a placeholder. To find yours:

```powershell
tailscale status --json | Select-String '"DNSName"'
```

Or look at it in the Tailscale console, in the device list.

### 1. On the PC

Install Tailscale and join your tailnet. Then publish the plugin:

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:6768
```

`--bg` keeps the configuration saved: it survives restarts.

Check that it answers **from the tailnet address**, not from localhost:

```powershell
(Invoke-WebRequest https://<machine>.<tailnet>.ts.net/health -UseBasicParsing).Content
```

The response includes `origin` and, if that address will not work from a phone, a `warning`
with its severity in `warningSeverity`:

- **`blocking`** — the link goes nowhere. Happens when the origin is `127.0.0.1`.
- **`warning`** — it loads, but the browser will not let you install it. Only happens with
  plain HTTP on a host that is not loopback; on loopback, `blocking` wins.

If no warning appears, the address is correct.

> Do not use `curl` in PowerShell 5.1: there it is an alias for `Invoke-WebRequest` and does
> not return raw JSON.

### 2. On the phone

1. Install **Tailscale** from your app store and sign in with **the same account**.
2. Check that the PC appears in the device list.

### 3. Pair

The QR is **shown on the PC** and **scanned with the phone**:

1. Open `https://<machine>.<tailnet>.ts.net/pair` **in the PC browser**, not on the phone.
2. From the phone camera, scan the QR on the screen.

It is the opposite of what it looks like: if you open `/pair` on the phone, the QR would be on
the very screen you are meant to scan.

> If you open `/pair` on the PC using `127.0.0.1`, the QR points at `127.0.0.1` and will not
> work. The page warns you with a red banner when that happens.

### 4. Install the app

1. Open the tailnet address **in the phone browser**.
2. Add it to the home screen:
   - **Android (Chrome)**: ⋮ menu → _Add to Home screen_ (or the install prompt).
   - **iOS (Safari)**: Share button → _Add to Home Screen_. On iOS it is always manual: there
     is no automatic prompt.

## Common problems

| Symptom                            | Cause                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| "Connection refused" when scanning | The QR points at `127.0.0.1`: open `/pair` through the tailnet name                         |
| The phone cannot see the PC        | Tailscale is not installed on the phone, or it is signed into another account               |
| The health check does not answer   | **DSH is closed**: with no plugin, nothing is listening                                     |
| No install option appears          | The browser needs HTTPS and a valid manifest. On iOS there is never a prompt: always manual |
| `tailscale serve --https` fails    | _HTTPS Certificates_ is not enabled in the console                                          |
| The QR shows a red banner          | The address you opened `/pair` from will not work from a phone                              |

## Forcing the address

Usually unnecessary: the plugin uses the address you came in through.

If there is a proxy that does not forward `Host`, you can pin it. The variable is read **once
when the plugin starts**, so it has to be set before DSH opens:

```powershell
[Environment]::SetEnvironmentVariable('DSH_MOBILE_PUBLIC_URL', 'https://<machine>.<tailnet>.ts.net', 'User')
```

Then **restart DSH** so it picks it up. Do it from a **new terminal**: the one already open
keeps the previous environment and will not see the variable.
`$env:DSH_MOBILE_PUBLIC_URL = ...` only affects the current PowerShell session and a DSH that
is already running will not see it.

## Notifications

On the phone, open Settings → Notifications and turn the switch on. The browser asks for the
notification permission; accept it. The subscription is stored for that device and survives a
reload; turning it off unsubscribes and removes it from the host.

- **Android/Chrome**: works in the browser and in the installed PWA.
- **iOS 16.4+**: only for the PWA added to the Home Screen, and background delivery is not
  guaranteed. Add it to the Home Screen, enable notifications, and keep the app open when you
  can.
- The host needs internet access to reach the push service, and the PWA must be served over
  HTTPS: use the tailnet address, not the loopback IP.

Alerts: one when the agent is waiting for an answer, one when the turn finishes. Tap either to
open that session.

## Out of scope

- **Direct LAN access**: the plugin does not listen outside loopback, so it does not work. It
  would be a code change, not a configuration one.
- **The open internet**: do not. This is a client that can run actions on your machine.
  Tailscale keeps the network private; opening the port to the internet does not.
