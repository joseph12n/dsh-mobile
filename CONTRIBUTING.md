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

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `pnpm build`     | Builds the three packages in topological order |
| `pnpm test`      | Vitest, the whole suite                        |
| `pnpm typecheck` | `tsc --noEmit` per package                     |
| `pnpm lint`      | ESLint                                         |
| `pnpm format`    | Prettier                                       |
| `pnpm dev`       | PWA in development mode                        |

Before proposing a change, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass
clean.

## Structure

```
packages/
  protocol/    the contract: Zod schemas + types + constants
  companion/   host plugin
    src/core/    pure domain (no DSH, no I/O)
    src/dsh/     the ONLY place that knows DSH
    src/routes/  serving the built PWA
  app/         PWA (React + Vite)
```

### Layer rules

1. **`core` imports nothing from `@deepseek-ai/*` and touches neither disk nor network.** Pure
   domain: tested with in-memory data.
2. **Only `dsh` knows DSH.** All the coupling with the host lives there, behind interfaces
   declared in `core`.
3. **`routes` does not know the domain.** It serialises the contract and nothing else.
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
- **English** in comments, identifiers and commit messages.
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

Real examples from this repository:

```
feat(app): adopt the real DeepSeek Harness palette and typography
fix(app): write the icon buffer without re-encoding it
ci: run the smoke test and the icon check
docs: align the documentation on LAN and tailnet
```

Subject rules:

- **In English**, in the imperative ("add", not "added").
- No full stop. **The whole line, prefix included, stays under 100 characters**: that is what
  `header-max-length` measures. If it does not fit, shorten the subject and explain in the
  body.
- The scope, in parentheses, names the area: `app`, `companion`, `protocol`, `docs`, `ci`.

The body explains **why**, not what. If the change breaks compatibility, add `!` after the
type (`feat(protocol)!: ...`) and a `BREAKING CHANGE:` footer explaining what breaks and how
to migrate.

Reference the issue in a footer, not in the subject:

```
fix(app): correct the PWA path

web-root computed the package root one level too high.

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
