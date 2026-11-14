# @deepseekharness-mobile/protocol

The versioned wire contract (`dsh-mobile/1`) shared by the [DSH Mobile](https://github.com/joseph12n/dsh-mobile)
host plugin and its PWA.

It contains the Zod schemas for the envelopes, the client and server messages, the capability
names and the pairing URL, so both ends validate the same frames.

## Install

```sh
pnpm add @deepseekharness-mobile/protocol
```

## Use

```ts
import { ClientMessage, PROTOCOL_VERSION, ServerMessage } from '@deepseekharness-mobile/protocol';

const frame = ClientMessage.safeParse(input);
```

## License

MIT
