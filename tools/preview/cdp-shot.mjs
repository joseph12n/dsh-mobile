import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const file = process.argv[2];
const port = process.argv[3] ?? '9222';
const width = Number(process.argv[4] ?? 390);
const height = Number(process.argv[5] ?? 844);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === 'page' && target.url.includes('127.0.0.1'));
if (!page) throw new Error('no app page');

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
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
await new Promise((resolve) => setTimeout(resolve, 400));

const metrics = await send('Runtime.evaluate', {
  expression: `(() => {
    const shell = document.querySelector('.shell');
    const composer = document.querySelector('.composer');
    return {
      innerHeight: window.innerHeight,
      shellHeight: shell ? Math.round(shell.getBoundingClientRect().height) : null,
      composerBottom: composer ? Math.round(composer.getBoundingClientRect().bottom) : null,
      composerVisible: composer ? composer.getBoundingClientRect().bottom <= window.innerHeight + 1 : null,
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(metrics.result.value));

const { data } = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
});
writeFileSync(file, Buffer.from(data, 'base64'));
console.log(`saved ${file}`);

ws.close();
