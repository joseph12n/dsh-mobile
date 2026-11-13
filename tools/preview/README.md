# Preview harness

Local tools for looking at the PWA and the contract without a phone. Nothing here ships: the
plugin package only contains `dist/`, and screenshots land in `out/`, which git ignores.

## Prerequisites

```bash
pnpm install
pnpm build
```

`pnpm build` compiles the three packages and copies the PWA into
`packages/companion/dist/web`, which is exactly what the preview server serves.

## Two ways to look at it

### The whole app with fake data

```bash
pnpm preview
```

Serves the built PWA and a fake host on `http://127.0.0.1:6799/`. Open `/pair` to get a code,
then pair. The fake host has folders, sessions, a pending question and a transcript with
tool runs.

### The Vite dev server with the scriptable fake host

Terminal 1:

```bash
pnpm dev
```

Terminal 2:

```bash
pnpm preview:host
```

Then open this URL (the code is irrelevant to the fake host, but the app needs one):

```
http://127.0.0.1:5173/#/pair?v=1&c=TESTCODE&e=ws://127.0.0.1:6799/ws
```

This is the combination the CDP drivers use.

## Headless browser drivers

Launch Edge with remote debugging first:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new `
  --remote-debugging-port=9222 --user-data-dir="$env:TEMP\dsh-edge-preview" `
  --disable-sync --disable-features=msSyncConfirmationDialog --no-first-run about:blank
```

Then, from the repo root:

```bash
node tools/preview/ui-drive.mjs tools/preview/out 9222 "<pair URL>"
```

Other drivers take the same first three arguments and a mode:

- `settings-drive.mjs` — gear, sheet, Escape, focus, contrast, reduced motion.
- `back-drive.mjs` — history and the back gesture.
- `folder-drive.mjs` — folder headings, sticky state, collapse.
- `question-drive.mjs` — a question arriving through the poll.
- `model-drive.mjs` — pinned model row in a long chat.
- `reasoning-drive.mjs` — reasoning disclosure above the answer.
- `spacing-check.mjs <out> <port> <url> <width> <height>` — overlaps and row gaps.
- `cdp-shot.mjs`, `cdp-eval.mjs` — one screenshot, one expression.
- `axe-view.mjs <out> <port> <url> <list|sheet|conversation>` — axe-core audit.
- `press-tab.mjs <port> <steps>` — walks the tab order and reports focus rings.

Screenshots and JSON reports go to `tools/preview/out/`.

## axe-core

`axe-view.mjs` and `axe-run.mjs` load `axe.min.js` from this folder. It is not committed
(third-party, 550 KB). Download it once:

```bash
curl -L https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js -o tools/preview/axe.min.js
```

## Live host probes

`live-probe.mjs` and `history-probe.mjs` pair against the real plugin on `127.0.0.1:6768` and
report what goes over the wire. They consume a pairing code from `/pair`. Delete the probe
device from `~/.dsh/companion/devices.json` afterwards, or restart DSH so it is not loaded.
