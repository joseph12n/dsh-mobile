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

const state = `(() => {
  const blocks = [...document.querySelectorAll('.msg-reasoning')];
  const first = blocks[0];
  const msg = first?.closest('.msg');
  return {
    reasons: blocks.length,
    open: first ? first.open : null,
    label: first?.querySelector('summary')?.textContent?.trim() ?? null,
    reasonLength: first?.querySelector('p')?.textContent?.length ?? 0,
    answer: msg ? [...msg.querySelectorAll(':scope > p')].map((p) => p.textContent.slice(0, 80)) : [],
    firstMessage: msg?.textContent?.slice(0, 220) ?? null,
    noise: [...document.querySelectorAll('.msg.user p')].filter((p) => /Time sampled|background job|runtime context/i.test(p.textContent)).length,
    userMessages: document.querySelectorAll('.msg.user').length,
    agentMessages: document.querySelectorAll('.msg.assistant').length,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  };
})()`;

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

await evaluate(`(() => {
  const option = document.querySelector('.questions .option');
  option?.click();
  document.querySelector('.questions .question-batch > button')?.click();
})()`);
await sleep(900);

await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.session-open')];
  rows.find((row) => row.textContent.includes('Restaurar la caché'))?.click();
})()`);
await sleep(2500);
await evaluate(
  `(() => { const area = document.querySelector('.session-scroll'); if (area) area.scrollTop = 0; })()`,
);
await sleep(400);

const result = {};
result.collapsed = await evaluate(state);
await shot('reasoning-01-collapsed');

result.opened = await evaluate(
  `(() => { const summary = document.querySelector('.msg-reasoning summary'); summary?.click(); return Boolean(summary); })()`,
);
await sleep(400);
result.expanded = await evaluate(state);
await shot('reasoning-02-expanded');

writeFileSync(`${outDir}/reasoning.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
