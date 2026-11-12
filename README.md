# DSH Mobile

Installable mobile **PWA** plus a host plugin for **[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**.

Control your sessions from your phone: see the state, read the transcript, answer and approve
questions, send messages and cancel runs. The PC still does all the work; the phone is a
remote control, not a second agent.

> **Status: phase 2, working.** Pair by QR, list sessions, read the transcript live, answer
> questions and approvals, write, and cancel runs. Deployment and polish are still open as
> GitHub issues.

---

## How it works

```
PC (runs DSH)                                      Phone
┌──────────────────────────────────────┐   ┌──────────────────────────┐
│ plugin @dsh-mobile/companion         │   │ PWA @dsh-mobile/app      │
│  · its own listener :6768            │◄─►│  · pairing               │
│  · serves the built PWA              │WS │  · sessions and state    │
│  · pairing by QR                     │   │  · transcript            │
│  · one token per device              │   │  · questions and answers │
│  · bridge to the DSH services        │   │  · composer              │
└──────────────────────────────────────┘   └──────────────────────────┘
```

The plugin runs **inside** the DSH process, so it sees the sessions without forking the core
and without breaking on upstream updates.

**The boundary is the contract.** The phone never talks to DSH's internals: it talks
`dsh-mobile/1`, a protocol of our own, versioned. Only the plugin knows DSH. If upstream
changes, one adapter changes and the client never notices.

**A single artifact.** The plugin serves the built PWA, so host and client cannot drift
apart: they are the same version by construction.

### Pairing

The desktop shows a **QR** that is not a bare code but a **direct link**:

```
https://<host>/#/pair?v=1&c=<code>&e=<endpoint>
```

One scan answers _where_ to connect and _who_ you are. The code travels in the URL fragment,
so it never reaches the server or a log. It expires in 10 minutes, works once, and redeeming
it creates a **device token** stored as a hash.

The token belongs to the device, not the network, so **the protocol does not tie a connection
to one address**. That said, honestly: **the app does not offer changing the endpoint yet**;
today, pointing at another address means pairing again.

And the only path that reaches the plugin is the **tailnet name**, because it listens on
loopback only. Direct LAN access is not implemented.

---

## Packages

| Package                                       | What it is                                              |
| --------------------------------------------- | ------------------------------------------------------- |
| [`@dsh-mobile/protocol`](packages/protocol)   | The contract: Zod schemas, types, constants. Isomorphic |
| [`@dsh-mobile/companion`](packages/companion) | Host plugin: listener, pairing, PWA, DSH adapter        |
| [`@dsh-mobile/app`](packages/app)             | PWA: React + Vite                                       |

The contract requires **TypeScript** everywhere: one schema, two consumers, and an
incompatible change breaks the build instead of the user.

---

## Requirements

- **Node.js 24** (the plugin runs on the Node DSH embeds; development uses the same version so
  we do not rely on APIs the host lacks).
- **pnpm 12**.
- DeepSeek Harness installed on the PC.

## Development

```bash
pnpm install
pnpm build        # protocol → companion → app (topological order)
pnpm test         # vitest
pnpm smoke        # starts the built server and checks the PWA and pairing
pnpm typecheck
pnpm lint
pnpm dev          # PWA on http://127.0.0.1:5173
```

`pnpm smoke` checks that **the package we would publish** works: it starts the `dist/` server
serving the `dist/` PWA on an ephemeral port and walks through pairing and listing sessions.

## Using the plugin

Link it from your DSH profile (`~/.dsh/profiles/<profile>/package.json`):

```json
{
  "dsh": { "profile": { "bundles": ["@dsh-mobile/companion"] } },
  "dependencies": { "@dsh-mobile/companion": "link:/path/to/dsh-mobile/packages/companion" }
}
```

The plugin listens on `127.0.0.1:6768` and exposes:

| Route         | What it does                                      |
| ------------- | ------------------------------------------------- |
| `GET /`       | The installable PWA                               |
| `GET /pair`   | Pairing QR and the code as text                   |
| `GET /health` | State, protocol version, capabilities and devices |
| `WS /ws`      | The `dsh-mobile/1` contract                       |

### The `/mobile` command

Inside DSH, `/mobile` opens the pairing page in the desktop browser, where the QR is an
image and scans with any font. Subcommands:

| Command          | What it does                                                  |
| ---------------- | ------------------------------------------------------------- |
| `/mobile`        | Opens `/pair`; also prints the link and the code              |
| `/mobile open`   | The same, spelled out                                         |
| `/mobile qr`     | Prints the QR **as text**, for a terminal with line height 1  |
| `/mobile link`   | Only the link and the code                                    |
| `/mobile status` | Diagnostic probe: services, projections, where text can go in |

The QR as text only scans where the line height equals the font size; the DSH chat does not
do that, which is why opening the page is the default.

Environment variables: `DSH_MOBILE_PORT`, `DSH_MOBILE_PUBLIC_URL`, `DSH_MOBILE_WEB_ROOT`.
`DSH_MOBILE_LOG_FILE=0` turns off the plugin's evidence file, which the tests and the preview
tool use so they do not dirty your log.

### What you can do from the phone

- See live sessions with their state and how many questions are waiting.
- Open a session and read the transcript, with paged history and live events.
- **Answer questions and approvals**, with the full text and the options.
- **Write** to the agent and **cancel** the running turn.

---

## Security

- **Loopback only.** The listen address is a constant in the code, not an option: the plugin
  serves `127.0.0.1` and is published through the tailnet name with `tailscale serve`. **It
  accepts no direct connections from the LAN** because it never opens that socket.
- **Never to the internet without solid authentication.** This is a client that can run
  actions on your machine. Today the tailnet's private network is the only supported path;
  exposing it to the internet is not.
- **One token per device, stored as a hash.** Revoking one does not affect the others.
- **The host decides.** The client does not hide with CSS what it cannot do: the server does
  not send it.
- **Narrow scope.** The phone does not change settings, credentials or plugins.

To use it away from home, **Tailscale** is the recommendation: serve the PWA over HTTPS on the
tailnet name — a secure context, its own certificate, and one URL for home and for the street.

---

## Documentation

- [`docs/phone-setup.md`](docs/phone-setup.md) — **how to use it from the phone**, step by
  step, with Tailscale and the usual problems.
- [`docs/architecture.md`](docs/architecture.md) — **why** it is built this way: layers,
  protocol, pairing, and the decisions we rejected.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to work on the repo.
- [`packages/protocol/src/messages.ts`](packages/protocol/src/messages.ts) — the contract, as
  code and as the source of truth.

## License

[MIT](LICENSE).
