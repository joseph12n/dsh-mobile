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

const inspect = `(() => {
  const result = document.querySelector('.command-result');
  const area = document.querySelector('.composer textarea');
  return {
    options: [...document.querySelectorAll('.command-option')].map((option) => option.textContent.trim()),
    menu: Boolean(document.querySelector('.command-menu')),
    slashButton: Boolean(document.querySelector('.command-button')),
    result: result ? { text: result.textContent.trim(), error: result.classList.contains('error') } : null,
    draft: area ? area.value : null,
    transcriptLines: document.querySelectorAll('.msg').length,
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

const result = {};
await evaluate(`document.querySelector('.session-open')?.click()`);
await sleep(2500);
result.opened = await evaluate(inspect);
await shot('command-01-open');

await evaluate(`document.querySelector('.command-button')?.click()`);
await sleep(400);
result.menu = await evaluate(inspect);
await shot('command-02-menu');

await evaluate(
  `[...document.querySelectorAll('.command-option')].find((option) => option.textContent.includes('/plan'))?.click()`,
);
await sleep(300);
result.chosen = await evaluate(inspect);

await evaluate(`document.querySelector('.send-button')?.click()`);
await sleep(900);
result.success = await evaluate(inspect);
await shot('command-03-success');

await evaluate(`document.querySelector('.composer textarea')?.focus()`);
await send('Input.insertText', { text: '/goal' });
await sleep(400);
await evaluate(`document.querySelector('.send-button')?.click()`);
await sleep(900);
result.error = await evaluate(inspect);
await shot('command-04-error');

writeFileSync(`${outDir}/command.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
