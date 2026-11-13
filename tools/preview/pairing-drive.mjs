import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const outDir = process.argv[2] ?? '.';
const debugPort = process.argv[3] ?? '9222';
const url = process.argv[4] ?? 'http://127.0.0.1:5173/';

const target = await (
  await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })
).json();

const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await sleep(4000);
await evaluate(`localStorage.clear()`);
await send('Page.reload', { ignoreCache: true });
await sleep(2500);

const result = {};
result.pairing = await evaluate(`(() => ({
  pairing: Boolean(document.querySelector('.pairing-card')),
  gear: Boolean(document.querySelector('.head .head-action')),
  footer: Boolean(document.querySelector('.foot')),
  sheetOpen: Boolean(document.querySelector('.sheet')?.open),
}))()`);
await shot('pair-00-pairing');

result.opened = await evaluate(
  `(() => { const gear = document.querySelector('.head .head-action'); if (!gear) return false; gear.click(); return true; })()`,
);
await sleep(500);
result.sheet = await evaluate(`(() => ({
  open: Boolean(document.querySelector('.sheet')?.open),
  sections: [...document.querySelectorAll('.sheet-section h3')].map((el) => el.textContent),
  address: document.querySelector('.sheet-endpoint')?.textContent ?? null,
  hasDeviceSection: [...document.querySelectorAll('.sheet-section h3')].some((el) => el.textContent.includes('Dispositivo')),
  active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
}))()`);
await shot('pair-01-settings');
await evaluate(`document.querySelector('.sheet-head .icon-button').click()`);
await sleep(500);
result.closed = await evaluate(
  `(() => ({ open: Boolean(document.querySelector('.sheet')?.open), state: history.state }))()`,
);

console.log(JSON.stringify(result, null, 2));
ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
