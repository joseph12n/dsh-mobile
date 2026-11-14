<div align="center">
  <img src="https://raw.githubusercontent.com/joseph12n/dsh-mobile/main/docs/assets/logo.png" width="72" alt="DSH Mobile" />

  <h1>@deepseekharness-mobile/protocol</h1>

  <p><strong>The versioned wire contract for DSH Mobile.</strong><br />
  Zod schemas for the envelopes, messages, capabilities and pairing URL shared by the host
  plugin and the PWA.</p>

  <p>
    <a href="https://www.npmjs.com/package/@deepseekharness-mobile/protocol"><img src="https://img.shields.io/npm/v/@deepseekharness-mobile/protocol?label=npm&color=4D6BFE" alt="npm" /></a>
    <a href="https://github.com/joseph12n/dsh-mobile/actions/workflows/ci.yml"><img src="https://github.com/joseph12n/dsh-mobile/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://sonarcloud.io/summary/new_code?id=joseph12n_dsh-mobile"><img src="https://sonarcloud.io/api/project_badges/measure?project=joseph12n_dsh-mobile&metric=alert_status" alt="Quality Gate" /></a>
    <a href="https://github.com/joseph12n/dsh-mobile/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-4D6BFE.svg" alt="License" /></a>
    <a href="https://github.com/joseph12n/dsh-mobile/blob/main/packages/protocol/package.json"><img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://github.com/joseph12n/dsh-mobile/blob/main/packages/protocol/package.json"><img src="https://img.shields.io/badge/node-%3E%3D24-339933?logo=nodedotjs&logoColor=white" alt="Node" /></a>
  </p>
</div>

## The contract

The phone never talks to DSH's internals. It talks **`dsh-mobile/1`**: a versioned protocol with
one Zod schema per frame, owned by this package and consumed by both ends.

- **One schema, two consumers.** An incompatible change breaks the build instead of the user.
- **Envelopes.** Every frame carries `v`, `id`, `at` and `type`; requests pair with `*.ok`
  responses and typed `error` frames.
- **Capabilities.** `hello.ok` lists what the host can do; the client gates its UI on that list.
- **Pairing.** `parsePairingUrl` and the 10-minute, single-use code format live here too.

## Install

```sh
pnpm add @deepseekharness-mobile/protocol
```

## Use

```ts
import { ClientMessage, PROTOCOL_VERSION, ServerMessage } from '@deepseekharness-mobile/protocol';

const frame = ClientMessage.safeParse(input);
if (!frame.success) throw new Error('not a dsh-mobile/1 frame');

const reply = ServerMessage.safeParse(output);
```

## Inside

| Module        | What it holds                                                  |
| ------------- | -------------------------------------------------------------- |
| `messages.ts` | The client and server message unions and the `error` codes     |
| `domain.ts`   | Sessions, transcripts, models, activity, providers and devices |
| `pairing.ts`  | The pairing URL and the code format                            |
| `version.ts`  | `PROTOCOL_VERSION` and the `dsh-mobile/1` constant             |

## Links

- [Repository](https://github.com/joseph12n/dsh-mobile) — the product and the host plugin.
- [`@deepseekharness-mobile/companion`](https://www.npmjs.com/package/@deepseekharness-mobile/companion)
  — the plugin that speaks this contract.
- [Architecture](https://github.com/joseph12n/dsh-mobile/blob/main/docs/architecture.md) — the
  layers and the decisions behind them.

## License

MIT
