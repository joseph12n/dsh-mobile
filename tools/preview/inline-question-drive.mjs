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

const metrics = `(() => {
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
  const scroll = document.querySelector('.session-scroll');
  const inline = document.querySelector('.questions.inline');
  const outside = document.querySelector('.shell-body > .questions');
  const composer = document.querySelector('.composer');
  const row = [...document.querySelectorAll('.session-open')].find((item) => item.textContent.includes('Restaurar la caché'));
  return {
    viewport: { w: innerWidth, h: innerHeight },
    listCard: Boolean(document.querySelector('.sessions-panel')) || Boolean(outside),
    inline: Boolean(inline),
    inlineRect: rect(inline),
    outsideCard: Boolean(outside),
    scroll: scroll ? { rect: rect(scroll), top: Math.round(scroll.scrollTop), height: scroll.scrollHeight } : null,
    composer: rect(composer),
    row: row ? row.textContent.slice(0, 80) : null,
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
result.list = await evaluate(metrics);
await shot('inline-01-list');

await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.session-open')];
  rows.find((row) => row.textContent.includes('Restaurar la caché'))?.click();
})()`);
await sleep(2500);
result.conversation = await evaluate(metrics);
await shot('inline-02-conversation');

result.answered = await evaluate(`(() => {
  const card = document.querySelector('.questions.inline');
  if (!card) return false;
  card.querySelector('.option')?.click();
  card.querySelector('.question-batch > button')?.click();
  return true;
})()`);
await sleep(1500);
result.afterAnswer = await evaluate(metrics);
await shot('inline-03-answered');

writeFileSync(`${outDir}/inline-question.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
