import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const outDir = process.argv[2] ?? '.';
const debugPort = process.argv[3] ?? '9222';
const base = process.argv[4] ?? 'http://127.0.0.1:6768';
const code = process.argv[5] ?? '';

const target = await (
  await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(
      code ? `${base}/#/pair?v=1&c=${code}` : base,
    )}`,
    { method: 'PUT' },
  )
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
  const style = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      text: (el.textContent || '').trim().slice(0, 90),
      color: s.color,
      background: s.backgroundColor,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      fontFamily: s.fontFamily.split(',')[0],
      lineHeight: s.lineHeight,
    };
  };
  return {
    url: location.href,
    sessions: document.querySelectorAll('.session-open').length,
    heading: document.querySelector('.session-heading')?.textContent ?? null,
    answer: style('.msg.assistant p'),
    user: style('.msg.user p'),
    reasoning: style('.msg-reasoning p'),
    tool: style('.tool'),
    toolGroup: style('.tool-toggle'),
    role: style('.msg-role'),
    assistantMessages: document.querySelectorAll('.msg.assistant').length,
    userMessages: document.querySelectorAll('.msg.user').length,
    reasoningBlocks: document.querySelectorAll('.msg-reasoning').length,
    toolGroups: document.querySelectorAll('.tool-group').length,
    statePills: document.querySelectorAll('.state-row').length,
    lastMessages: [...document.querySelectorAll('.msg p')].slice(-4).map((p) => p.textContent.slice(0, 100)),
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
await sleep(6000);

const result = {};
result.list = await evaluate(
  `(() => ({ sessions: document.querySelectorAll('.session-open').length, pairing: Boolean(document.querySelector('.pairing-card')), text: document.body.innerText.slice(0, 200) }))()`,
);
await shot('live-01-list');

await evaluate(`document.querySelector('.session-open')?.click()`);
await sleep(4000);
result.conversation = await evaluate(inspect);
await shot('live-02-conversation');

await evaluate(
  `(() => { const area = document.querySelector('.session-scroll'); if (area) area.scrollTop = area.scrollHeight; })()`,
);
await sleep(500);
await shot('live-03-bottom');

writeFileSync(`${outDir}/live-ui.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
