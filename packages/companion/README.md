# @deepseekharness-mobile/companion

The [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) host plugin for **DSH
Mobile**: a WebSocket bridge on port 6768, QR and device-token pairing, the embedded PWA and the
session/transcript/question/command/provider/device features described in the
[root README](https://github.com/joseph12n/dsh-mobile).

## Install

```sh
dsh profile add @deepseekharness-mobile/companion
```

The profile reads the bundle's `cordis.patch.yml` and mounts the plugin. Restart DSH after the
install; the PWA is served at `/` and pairing at `/pair`. For the tailnet and phone steps, see
[docs/phone-setup.md](https://github.com/joseph12n/dsh-mobile/blob/main/docs/phone-setup.md).

## Security

The listener binds loopback by default and a phone must pair before any frame is accepted.
Device tokens can be revoked from the phone or from the host devices file. Do not expose the
listener directly to the internet; use the tailnet or a reverse proxy with TLS.

## License

MIT
