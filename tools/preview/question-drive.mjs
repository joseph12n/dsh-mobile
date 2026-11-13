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
  const card = document.querySelector('.questions');
  const row = [...document.querySelectorAll('.session-open')].find((item) => item.textContent.includes('Restaurar la caché'));
  const meta = row?.parentElement?.querySelector('.session-meta');
  return {
    card: Boolean(card),
    text: card?.querySelector('.question-text')?.textContent ?? null,
    header: card?.querySelector('.question-header')?.textContent ?? null,
    rowState: meta?.querySelector('.state')?.textContent?.trim() ?? null,
    badge: meta?.querySelector('.badge.waiting')?.textContent ?? null,
    polls: globalThis.__polls ?? 0,
    history: history.state,
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
result.initial = await evaluate(state);
await shot('question-01-initial');

await evaluate(`(() => {
  globalThis.__polls = 0;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === 'string' && data.includes('"sessions.list"')) globalThis.__polls += 1;
    } catch {}
    return send.call(this, data);
  };
})()`);

result.answeredInitial = await evaluate(`(() => {
  const option = document.querySelector('.questions .option');
  if (!option) return false;
  option.click();
  document.querySelector('.questions .question-batch > button')?.click();
  return true;
})()`);
await sleep(1500);
result.afterInitialAnswer = await evaluate(state);
await shot('question-02-settled');

await sleep(11000);
result.arrived = await evaluate(state);
await shot('question-03-live');

result.answeredLater = await evaluate(`(() => {
  const card = document.querySelector('.questions');
  if (!card) return false;
  const option = card.querySelector('.option');
  option?.click();
  card.querySelector('.question-batch > button')?.click();
  return true;
})()`);
await sleep(1500);
result.afterLaterAnswer = await evaluate(state);
await shot('question-04-done');

writeFileSync(`${outDir}/questions.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
