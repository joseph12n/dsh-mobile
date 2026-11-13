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
apart: they are the same version by construction. Today that means running both from the same
checkout; packaging them together is still an open issue (#12).

### Pairing

The desktop shows a **QR** that is not a bare code but a **direct link**:

```
https://<host>/#/pair?v=1&c=<code>
```

One scan answers _who_ you are; the connection goes to the host serving that page. The code travels in the URL fragment,
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
pnpm build        # protocol first: the other two import its types
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

| Route         | What it does                                       |
| ------------- | -------------------------------------------------- |
| `GET /`       | The installable PWA                                |
| `GET /pair`   | Pairing QR and the code as text                    |
| `GET /health` | State, protocol version, capabilities and devices  |
| `GET /probe`  | The same diagnostic report `/mobile estado` prints |
| `WS /ws`      | The `dsh-mobile/1` contract                        |

### The `/mobile` command

Inside DSH, `/mobile` prints **the pairing link, the code and when it expires**, so you do not
have to hand-build a URL or dig the code out of the console. `/mobile estado` prints the
diagnostic probe: which services are mounted, what the projections expose, and which ones can
take text.

The link comes out with the tailnet name when Tailscale is installed, so it can be opened
straight from the phone. When it cannot — no Tailscale, or a loopback origin — the message says
so instead of handing you a link that goes nowhere.

Environment variables: `DSH_MOBILE_PORT`, `DSH_MOBILE_PUBLIC_URL`, `DSH_MOBILE_WEB_ROOT`.
`DSH_HOME` decides where the plugin keeps its `companion/` folder and its evidence file.
`DSH_MOBILE_LOG_FILE=0` turns off the plugin's evidence file, which the tests and the preview
tool use so they do not dirty your log.

### What you can do from the phone

- See live sessions with their state, how many questions are waiting, and the folder they
  belong to. Folders carry their own icon and colour, keep their heading on screen while the
  list scrolls, and collapse.
- Open a session and read the transcript, with paged history and live events.
- **Choose the model and reasoning effort** from the top of the conversation, without
  scrolling back through it.
- **Answer questions and approvals**, with the full text and the options — including the
  agent's blocking `ask_user_question`, which does not need a timed preset.
- **Write** to the agent and **cancel** the running turn.
- Open the gear for language, contrast, folder preferences and the paired device. The phone's
  back gesture closes the sheet or the conversation before it leaves the app.

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

## Accessibility

The app targets WCAG 2.2 AA:

- **Focus and keyboard.** Opening a conversation moves focus to its title; coming back moves
  it to the session list heading, and both show a visible ring. The transcript is a polite
  live log with its own name, and every control has an accessible name.
- **Touch targets.** Interactive controls are at least 44×44 CSS pixels, including the
  icon-only buttons and the action at the end of each session row.
- **Motion.** What moves is transition-based. Under `prefers-reduced-motion` the movement is
  dropped while an opacity change keeps the state change legible; press feedback does not
  scale either.
- **Contrast.** Text is measured against the background it actually renders on; nothing
  falls below 4.5:1.
- **Language.** The document language follows the interface, and the four locales are
  complete.

The audit covers the session list (with folders), a conversation, the pairing screen, the
settings sheet and a pending question card: **0 violations** across the WCAG 2.0, 2.1 and 2.2
A and AA rules, plus the best-practice rules on the question and conversation screens. The
audit is a local CDP harness; it is not part of CI because it needs a browser.

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
