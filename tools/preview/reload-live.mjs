import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const outDir = process.argv[2] ?? '.';
const debugPort = process.argv[3] ?? '9222';
const appHost = process.argv[4] ?? '127.0.0.1:6768';

const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const page =
  targets.find((target) => target.type === 'page' && target.url.includes(appHost)) ??
  targets.find((target) => target.type === 'page');
if (!page) throw new Error('no app page');

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
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

const styles = `(() => {
  const style = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      text: (el.textContent || '').trim().slice(0, 100),
      color: s.color,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
    };
  };
  return {
    url: location.href,
    pairing: Boolean(document.querySelector('.pairing-card')),
    sessions: document.querySelectorAll('.session-open').length,
    heading: document.querySelector('.session-heading')?.textContent ?? null,
    answer: style('.msg.assistant > p'),
    user: style('.msg.user > p'),
    reasoning: style('.msg-reasoning p'),
    answerCount: document.querySelectorAll('.msg.assistant > p').length,
    reasoningCount: document.querySelectorAll('.msg-reasoning').length,
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

await send('Page.reload', { ignoreCache: true });
await sleep(5000);

const result = {};
result.list = await evaluate(styles);
await evaluate(`document.querySelector('.session-open')?.click()`);
await sleep(3500);
await evaluate(
  `(() => { const area = document.querySelector('.session-scroll'); if (area) area.scrollTop = area.scrollHeight; })()`,
);
await sleep(500);
result.conversation = await evaluate(styles);
await shot('live-04-bright');

writeFileSync(`${outDir}/live-bright.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
