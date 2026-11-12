# Contributing

Thanks for the interest. This is a small, experimental project; the priority is that the
code stays easy to reason about and that the boundary with DeepSeek Harness stays clean.

## Before you start

Read the [README](README.md) to understand the shape of the system. The idea that orders the
whole design:

> The phone speaks **a contract of its own**. Only the plugin knows DSH's internals.

If a proposal makes the PWA depend on DSH internals, it points against the project.

## Environment

- Node.js **24** (the plugin runs on the Node DSH embeds).
- pnpm **12**.

```bash
pnpm install
pnpm build
pnpm test
```

## Commands

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `pnpm build`        | Builds the three packages in dependency order  |
| `pnpm test`         | Vitest, the whole suite                        |
| `pnpm test:watch`   | Vitest in watch mode                           |
| `pnpm typecheck`    | `tsc --noEmit` per package                     |
| `pnpm lint`         | ESLint                                         |
| `pnpm lint:fix`     | ESLint, fixing what it can                     |
| `pnpm format`       | Prettier, writing                              |
| `pnpm format:check` | Prettier, checking only                        |
| `pnpm smoke`        | Starts the built server and walks the contract |
| `pnpm clean`        | Removes build output                           |
| `pnpm dev`          | PWA in development mode                        |

Before proposing a change, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass
clean.

`DSH_HOME` decides where the plugin keeps its `companion/` folder, and the evidence file lives
there. The tests and the preview tool do not redirect it: they set `DSH_MOBILE_LOG_FILE=0` so
the log is never opened, and the tests keep device state in memory.

## Structure

```
packages/
  protocol/    the contract: Zod schemas + types + constants
  companion/   host plugin
    src/core/      pure domain (no DSH, no I/O)
    src/dsh/       the ONLY place that talks to DSH
    src/persist/   the little that reaches disk (the device file)
    src/routes/    static serving and origin checks
    src/server.ts  the WebSocket listener and the contract wiring
  app/         PWA (React + Vite)
```

### Layer rules

1. **`core` imports nothing from `@deepseek-ai/*` and touches neither disk nor network.** Pure
   domain: tested with in-memory data.
2. **Only `dsh` talks to DSH**, with one deliberate exception: `probe.ts`, the diagnostic
   report, reads host services directly. It exists to answer "what can this host do", so going
   through the adapter would hide the very thing it measures. The shapes those services have
   are declared in `src/host-api.ts`, which is a type contract and no runtime.
3. **`routes` does not know the domain.** It serves static files and computes the public
   origin; the contract is serialised in `server.ts`.
4. **`app` does not know DSH.** Only `@dsh-mobile/protocol`.

Breaking rule 2 is the fastest way for a DSH update to break the project.

## The contract

`packages/protocol` is the **single source of truth**. The Zod schemas generate the types.

- A new message enters `messages.ts` as a discriminated union on `type`.
- Every message carries the envelope `{ v, id, at, type }`.
- Replies reuse the request `id`.
- Incompatible change ⇒ bump `PROTOCOL_VERSION` and adjust `SUPPORTED_PROTOCOL_VERSIONS`. An
  old host must **reject** the new client with `proto-unsupported`, never fail in a strange
  way.
- Errors use the codes in `errors.ts`. Do not invent ad-hoc codes: a client branches on them.

Every new message needs its validation test in `protocol.test.ts`.

## Style

- **Strict TypeScript.** No `any` without a reason.
- **ESM.** Relative imports with the `.js` extension.
- **Identifiers in English**, always. Comments and commit messages are **moving to English**:
  new and edited code is written in English, and older comments still to be translated are
  not worth a whitespace-only diff on their own.
- Prettier owns the formatting; do not argue about formatting in a PR.

## Tests

- Unit: domain logic, contract validation.
- Integration: the listener against a real WebSocket client (`server.test.ts` does it on an
  ephemeral port).

A feature "tested only in a browser emulator" is not accepted when it touches the phone: if it
touches the phone, it gets tested on a phone.

## Commits and PRs

This repository follows **[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)**.
`commitlint` checks it on every pull request, so a message out of format breaks CI.

```
<type>[optional scope]: <description>

[optional body, one blank line after the subject]

[optional footers]
```

| Type       | When                                    |
| ---------- | --------------------------------------- |
| `feat`     | A new feature                           |
| `fix`      | A bug fixed                             |
| `docs`     | Documentation only                      |
| `style`    | Formatting, no change in behaviour      |
| `test`     | Tests only                              |
| `refactor` | Internal change, no change in behaviour |
| `perf`     | Performance improvement                 |
| `build`    | Dependencies or packaging               |
| `ci`       | Workflows and automation                |
| `chore`    | Maintenance that fits none of the above |
| `revert`   | Undoing an earlier commit               |

Real subjects from this repository's history:

```
feat(protocol): define workspaces and let the probe find the service
fix(app): keep the pairing through network drops
feat(app): agrupa el detalle de la sesión por turnos
ci: valida los mensajes de commit con commitlint
```

**The history is mixed on purpose, and you should know it before you read it as an
inconsistency:** commits written before the project moved to English have Spanish subjects
(the last two above), and everything since has English ones. History that is already published
is not rewritten — it costs more than it tidies. `commitlint` therefore accepts both: it
checks the _shape_, not the language.

Subject rules:

- **In English** for new commits, in the imperative ("add", not "added").
- No full stop. **The whole line, prefix included, is at most 100 characters**: that is what
  `header-max-length` measures. If it does not fit, shorten the subject and explain in the
  body.
- The scope, in parentheses, names the area: `app`, `companion`, `protocol`, `docs`, `ci`.

The body explains **why**, not what. If the change breaks compatibility, add `!` after the
type (`feat(protocol)!: ...`) and a `BREAKING CHANGE:` footer explaining what breaks and how
to migrate.

Reference the issue in a footer, not in the subject:

```
fix(app): correct the PWA path

web-root computed the package root one level too few.

Refs: #16
```

### PR

- A PR that changes the contract must explain compatibility.
- If something is **not** verified, say so in the PR. A "I have not tested this" is better
  than a claim by intuition.
- Merging uses **squash**, so the PR title becomes the commit message and **is validated with
  the same rules** as commits (`commitlint` checks it in a separate step). Commits already
  merged as merge commits stay as they are: rewriting published history breaks more than it
  tidies.

## Security

A security bug here is serious: the client can run actions on the user's machine.

- No secrets in the repository. No tokens in logs.
- Device tokens are stored **hashed**.
- Pairing codes are single use and expire.
- The host is not exposed to the internet without solid authentication.
- If you find a vulnerability, **do not open a public issue**: report it privately to whoever
  maintains the repo.
