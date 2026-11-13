import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const outDir = process.argv[2] ?? '.';
const debugPort = process.argv[3] ?? '9222';
const pairUrl = process.argv[4];

const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const page =
  targets.find((target) => target.type === 'page' && target.url.includes('127.0.0.1')) ??
  targets.find((target) => target.type === 'page');
if (!page) throw new Error('no page target');

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
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
}

const metricsScript = `(() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  const describe = (el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 40) });
  const clipped = [...document.querySelectorAll('button, a, summary, select, input, textarea, .badge')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    .map((el) => ({ ...describe(el), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  const offscreen = [...document.querySelectorAll('button, .session-row, .card, .settings, .composer')]
    .filter((el) => { const b = el.getBoundingClientRect(); return b.right > window.innerWidth + 0.5 || b.left < -0.5; })
    .map((el) => ({ ...describe(el), rect: rect(el) }));
  const composer = document.querySelector('.composer');
  const shell = document.querySelector('.shell');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    scrollY: Math.round(window.scrollY),
    documentHeight: document.documentElement.scrollHeight,
    shell: shell ? rect(shell) : null,
    composer: composer ? { rect: rect(composer), position: getComputedStyle(composer).position, inView: composer.getBoundingClientRect().bottom <= window.innerHeight + 1 } : null,
    clipped,
    offscreen,
    buttons: [...document.querySelectorAll('button')].slice(0, 12).map((el) => ({ ...describe(el), rect: rect(el) })),
  };
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

await send('Page.navigate', { url: pairUrl });
await sleep(500);
await send('Page.reload', { ignoreCache: true });
await sleep(6000);

const listMetrics = await evaluate(metricsScript);
writeFileSync(`${outDir}/metrics-list.json`, JSON.stringify(listMetrics, null, 2));
await shot('01-list');

const opened = await evaluate(
  `(() => { const row = document.querySelector('.session-open'); if (!row) return false; row.click(); return true; })()`,
);
await sleep(3500);
const conversationMetrics = await evaluate(metricsScript);
writeFileSync(`${outDir}/metrics-conversation.json`, JSON.stringify(conversationMetrics, null, 2));
await shot('02-conversation');

await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
await sleep(600);
await shot('03-conversation-bottom');
const bottomMetrics = await evaluate(metricsScript);
writeFileSync(`${outDir}/metrics-conversation-bottom.json`, JSON.stringify(bottomMetrics, null, 2));

const back = await evaluate(
  `(() => { const target = document.querySelector('.session-top .icon-button'); if (!target) return false; target.click(); return true; })()`,
);
await sleep(1200);
const settings = await evaluate(
  `(() => { const summary = document.querySelector('.settings > summary'); if (!summary) return false; summary.click(); return true; })()`,
);
await sleep(600);
await shot('04-settings');
writeFileSync(
  `${outDir}/metrics-settings.json`,
  JSON.stringify(await evaluate(metricsScript), null, 2),
);

console.log(
  JSON.stringify(
    {
      opened,
      back,
      settings,
      list: listMetrics,
      conversation: conversationMetrics,
      bottom: bottomMetrics,
    },
    null,
    2,
  ),
);

ws.close();
