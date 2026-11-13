import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const outDir = process.argv[2] ?? '.';
const debugPort = process.argv[3] ?? '9222';
const pairUrl = process.argv[4];

const target = await (
  await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pairUrl)}`, {
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

const snapshot = `(() => ({
  url: location.href,
  historyLength: history.length,
  historyState: history.state,
  list: Boolean(document.querySelector('.sessions-panel')),
  conversation: Boolean(document.querySelector('.session-view')),
  heading: document.querySelector('.session-heading')?.textContent ?? null,
  rows: document.querySelectorAll('.session-open').length,
  scrollTop: Math.round(document.querySelector('.session-scroll')?.scrollTop ?? -1),
}))()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await sleep(5500);

const result = {};
result.afterPair = await evaluate(snapshot);
await shot('nav-00-list');

result.opened = await evaluate(
  `(() => { const row = document.querySelector('.session-open'); if (!row) return false; row.click(); return true; })()`,
);
await sleep(2500);
result.afterOpen = await evaluate(snapshot);
await shot('nav-01-conversation');

result.scrolled = await evaluate(
  `(() => { const area = document.querySelector('.session-scroll'); if (!area) return null; area.scrollTop = area.scrollHeight; return { scrollHeight: area.scrollHeight, scrollTop: area.scrollTop }; })()`,
);
await sleep(300);

result.uiBack = await evaluate(
  `(() => { const target = document.querySelector('.session-top .icon-button'); if (!target) return false; target.click(); return true; })()`,
);
await sleep(1200);
result.afterUiBack = await evaluate(snapshot);
await shot('nav-02-after-ui-back');

result.reopened = await evaluate(
  `(() => { const row = document.querySelector('.session-open'); if (!row) return false; row.click(); return true; })()`,
);
await sleep(2500);
result.afterReopen = await evaluate(snapshot);

await evaluate(`history.back()`);
await sleep(1200);
result.afterHistoryBack = await evaluate(snapshot);
await shot('nav-03-after-history-back');

writeFileSync(`${outDir}/navigation.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
