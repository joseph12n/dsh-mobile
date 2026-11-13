# Architecture and protocol

This document explains **why** the system is built this way. If you are going to change
something, read this page first: half the design is the decisions we rejected.

---

## 1. The shape in one sentence

The PC runs DeepSeek Harness and owns the sessions; the phone is a **remote control** that
speaks a **contract of its own, versioned**, to a plugin running inside DSH.

```
PC (runs DSH)                                      Phone
┌──────────────────────────────────────┐   ┌──────────────────────────┐
│ plugin @dsh-mobile/companion         │   │ PWA @dsh-mobile/app      │
│  · its own listener :6768            │◄─►│  · pairing               │
│  · serves the built PWA              │WS │  · sessions and state    │
│  · pairing by QR                     │   │  · transcript            │
│  · one token per device              │   │  · questions             │
│  · adapter to the DSH services       │   │  · composer              │
└──────────────────────────────────────┘   └──────────────────────────┘
```

## 2. The boundary is the contract

The phone **never** talks to DSH's internals. It talks `dsh-mobile/1`, defined in
`packages/protocol` with Zod schemas. The consequences are deliberate:

- Upstream can reorganise its internal services and the client **does not notice**: you
  change `packages/companion/src/dsh/` and that is it.
- An incompatible change breaks the **build**, not the user on the phone.
- Anyone can write another client without reading DSH's code.

## 3. The layers

```
packages/companion/src/
  core/      pure domain: pairing, devices. No DSH, no I/O
  dsh/       the ONLY place that knows DSH. One file per concern
  routes/    serving the built PWA
```

The rules that do not bend:

1. **`core/` does not import `@deepseek-ai/*`** and touches neither disk nor network. It is
   tested with in-memory data and an injected clock.
2. **Only `dsh/` talks to DSH**, plus `probe.ts`, which reads host services on purpose: it is
   the diagnostic report, and routing it through the adapter would hide what it measures. That
   folder is the bumper: when upstream changes, the damage is confined there.
3. **`app/` does not know DSH.** Only `@dsh-mobile/protocol`.

Breaking rule 2 is the fastest way for a DSH update to break the project.

## 4. A single artifact

The plugin serves the built PWA. That means **host and client are the same version by
construction**: the "old app against a new plugin" scenario cannot happen.

## 5. How DSH services are reached

A rule learned the hard way: **nothing outside `inject` is read as a property**.

```ts
ctx.sessions; // works: it is declared in inject
ctx.get('sessionController'); // works: the reflection proxy
ctx.reflect.store; // indexed by SYMBOLS, not by strings
```

If something shows up as `undefined`, it is almost always this.

## 6. Decisions we rejected, and why

| Option                                 | Why it was rejected                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Reusing `dsh-experimental-liveshare`   | It serves the **desktop UI** to a phone — the opposite of the goal — and needs a Relay with OAuth               |
| Proxying the web UI                    | The token is injected by Electron and cannot be recovered from outside                                          |
| A client over the internal API Gateway | The `rc` protocol is tied to the desktop and changes without notice                                             |
| A sidecar in Go/Rust                   | A second runtime, its own IPC and double authentication, to talk to a Node process that already gives us access |

The LiveShare lesson we **did** adopt: _CSS is not authorisation_. The server does not send
what the client cannot do.

## 7. The protocol

Transport: **WebSocket**, JSON messages, shared envelope `{ v, id, at, type }`.

- **`hello` first.** Without it, any other request is rejected with `auth-required`, with one
  exception: `ping` answers `pong` unauthenticated, so a client can measure the link before it
  has a token.
- **`id` correlates.** The reply repeats the request `id`.
- **Errors carry a stable code** (`errors.ts`). A client branches on the code, never on the
  text.
- **Host messages with no request** are spontaneous sends. The contract defines
  `question.pending`, `question.settled`, `session.event`, `session.state` and
  `devices.changed`; this host emits the first, the third, and nothing else yet — the rest are
  declared so a client can already branch on them.
- Unknown version ⇒ `proto-unsupported` with the host's capabilities, never a strange
  failure.

### Messages

| Client → Host         | Host → Client                           |
| --------------------- | --------------------------------------- |
| `hello`               | `hello.ok` / `error`                    |
| `pair.redeem`         | `pair.ok`                               |
| `sessions.list`       | `sessions.ok` (+ `question.pending`)    |
| `workspace.list`      | `workspace.ok` (folders of the desktop) |
| `session.history`     | `history.ok`                            |
| `session.subscribe`   | `session.ok` (+ `session.event`)        |
| `reply.send`          | `reply.ok`                              |
| `question.answer`     | `answer.ok`                             |
| `commands.list`       | `commands.ok`                           |
| `command.run`         | `command.ok`                            |
| `session.activity`    | `activity.ok`                           |
| `devices.list`        | `devices.ok`                            |
| `devices.revoke`      | `devices.revoked` (+ `devices.changed`) |
| `providers.list`      | `providers.ok`                          |
| `provider.test`       | `provider.tested`                       |
| `provider.connect`    | `provider.connected`                    |
| `provider.disconnect` | `provider.disconnected`                 |
| `run.cancel`          | `run.ok`                                |
| `run.start`           | `error` (not implemented in this build) |
| `ping`                | `pong`                                  |

## 8. Pairing

The QR carries no bare code but a **direct link**:

```
https://<host>/#/pair?v=1&c=<code>
```

- The code travels in the **fragment**, so it is neither sent to the server nor logged.
  The endpoint, when it is pinned, travels as an `e=` parameter next to the code.
- **128 bits** in Crockford base32 (no `I`, `L`, `O` or `U`, so nobody misreads a character
  while typing it).
- **Single use, 10 minutes.** A failed attempt distinguishes _expired_, _already used_ and
  _does not exist_: that is the message that actually helps.
- Redeeming creates a **device token** of 32 bytes handed over **once**. Only its
  **SHA-256** stays on disk, compared in constant time.

The token belongs to the device, not the network: **the protocol does not tie a connection
to one address**.

That said, honestly: **the app does not offer changing the endpoint yet**. Today, pointing at
another address means pairing again. The token not being tied to the network is a property of
the design, not a feature you can use.

And today the plugin listens **on loopback only**, so direct LAN access does not work. It is
published through the tailnet name with `tailscale serve`, which reaches loopback and brings
HTTPS with it.

## 9. Questions: the batch is the unit

DSH groups the questions of one `ask_user_question` call and **validates the answer per
batch**: every question must appear exactly once. That is why the contract models
`QuestionBatch`, not loose questions.

`selected: []` without `custom` means **skipped**, and that is a legitimate answer — different
from not answering.

There are two paths, because DSH has two:

- **Timed questions** live in the `userQuestions` projection (open, then continued after the
  deadline). The phone reads them from `sessions.list` and answers through
  `ctx.userQuestions.answer`, which accepts continued questions.
- **Blocking questions do not enter that projection at all.** They are answered on the
  `user-questions/request` Cordis waterfall. The companion registers a listener there
  (`prepend`, `global`) and: publishes the batch to every paired device, calls `next()` so the
  desktop keeps its own card, and resolves with whichever answer arrives first. The phone's
  answer returns through `question.answer`; the bridge settles the card on every path
  (answered on the phone, answered on the desktop, or turn cancelled).

The bridge batches are added to the session's `pendingQuestions` count and to the
`question.pending` pushes after `sessions.list`, so the list shows _waiting for you_ and a phone
that reconnects still sees the question. Timed requests are left to the projection path.

Answering a question still needs the session's **root agent alive**; if it is not, the host
answers `not-found` saying so.

## 10. Commands: the host registry, run directly

DSH's `commands` service is a host-side registry: a command runs against the live agent and
**never becomes a model message**. The phone mirrors the desktop's command surface instead of
inventing one:

- `commands.list(sessionId)` returns the effective descriptors for that session's live agent
  (global plus agent-scoped, name-sorted). No live agent ⇒ empty list; the palette stays hidden.
- The composer shows a filtered palette when the draft starts with `/`; a `/` button opens it.
  Selecting a command inserts `/name `; sending the line calls `command.run`.
- `commands.execute(agent, line, …)` is the same entry point the desktop uses. The phone does
  not parse the command grammar.
- The result (`success`/`error` plus text) is returned in `command.ok` and rendered **above the
  composer**, outside the transcript, matching the desktop's outside-history result. The
  `command/run` and `command/done` events still land in the session log.
- The host advertises `command.run` only when both the command registry and the agent registry
  are present. No attachments in this first version; the command timeout on the phone is two
  minutes.

## 11. Activity: goal, subagents and tasks

The session projections already carry what the agent is doing; the phone only had no view of
it. `session.activity` is a read-only request for the open session:

- **Goal** from the `goal` projection: objective, phase, rounds started and the round cap.
- **Subagents** from the live `subagents.listDescendants(sessionId)`: each child's label,
  `running`/`inactive` activity and depth. Diagnostics are skipped; the list is capped at 20
  and running children sort first.
- **Tasks** from the `todos` projection: open and total counts plus at most 8 items with their
  status. `planActive` comes from the `plan` projection.
- The host advertises `session.activity` only when the session store and the projections are
  present. The phone asks when a session opens and every 6 s while it is open; a session with
  nothing to show renders no strip.
- The strip is a native `<details>` under the model row: chips for the goal round, running
  subagents, open tasks and plan; the body lists them. Nothing here controls the agent.

## 12. Transcript

- **History**: `sessionController.page()` returns a page of the log.
- **Live**: `observeEvent()` delivers a stream of events as they are committed.
- The translation is **tolerant on purpose**: events the phone knows how to draw are
  recognised and the rest is discarded. Inventing a line is worse than leaving a gap.
- The client merges both sources by `seq`, so reconnecting does not duplicate.

## 13. Security

- **Loopback only.** The listen address is a constant (`HOST = '127.0.0.1'`), not a
  configuration option: there is no network mode. It is published through the tailnet name
  with `tailscale serve`, which reaches loopback and brings HTTPS. Device authentication
  already exists; what we do not want is an open port.
- **One token per device**, stored as a hash; revoking one does not affect the others.
- **Device revocation is immediate.** A paired device can list the paired devices and revoke
  one: the host deletes the token, closes every live socket of that device and broadcasts
  `devices.changed` to the rest. The frames carry public device metadata only, never the token
  or its hash. Revoking yourself is the "forget this phone" path; the next request with the old
  token is `auth-invalid`.
- **Model providers are key-only from the phone.** The phone names a provider from the host's
  catalog, sends a key and nothing else; the host derives the credential reference, stores the
  key with the credentials service and never returns it. `baseURL`, `api`, `apiKeyEnv`,
  `headers`, model lists/overrides, route deletion and OAuth stay on the desktop: letting the
  phone move an endpoint while a stored key exists would send that key to another host. The
  test is a one-shot discovery against the host's own endpoint; a failed save reports whether
  the key was already stored.
- **Bounded listener.** At most 50 concurrent sockets and 32 paired devices; a socket that does
  not send `hello` within 10 s closes; a 20 s heartbeat reaps half-open clients; `lastSeenAt`
  is flushed to disk every 30 s only when it changed; `probe.log` rotates at 1 MiB keeping one
  copy. Pairing is reachable from the tailnet, so the tailnet ACLs are the real perimeter:
  there is no per-IP redeem limit because every connection arrives from loopback through
  `tailscale serve`, and codes are 128-bit, single-use and short-lived.
- **Narrow scope**: sessions, questions, runs and commands. No settings, credentials or plugin
  management.
- **The host decides.** Capabilities are announced in `hello.ok` and the server does not send
  what the client cannot do.

## 14. Status

Phases 0 and 1 closed with evidence; phase 2 works end to end: pair, list sessions, read the
transcript, answer questions, write, cancel, run the host's commands and follow the session's
activity.

The pending work is in GitHub issues.
