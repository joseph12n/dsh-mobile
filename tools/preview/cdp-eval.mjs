import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const expression = readFileSync(process.argv[2], 'utf8');
const port = process.argv[3] ?? '9222';
const width = Number(process.argv[4] ?? 390);
const height = Number(process.argv[5] ?? 844);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

let id = 0;
function send(method, params = {}) {
  const mine = ++id;
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== mine) return;
      ws.off('message', handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
}

await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (process.argv[6] === 'reduce' || process.argv[6] === 'motion') {
  await send('Emulation.setEmulatedMedia', {
    features: [
      {
        name: 'prefers-reduced-motion',
        value: process.argv[6] === 'reduce' ? 'reduce' : 'no-preference',
      },
    ],
  });
}
await new Promise((resolve) => setTimeout(resolve, 300));

const result = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
});
if (result.exceptionDetails) console.error(result.exceptionDetails.text);
else console.log(JSON.stringify(result.result.value, null, 2));

ws.close();
