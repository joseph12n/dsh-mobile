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
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
  const view = document.querySelector('.session-view');
  const model = document.querySelector('.session-model');
  const scroll = document.querySelector('.session-scroll');
  const composer = document.querySelector('.composer');
  const summary = document.querySelector('.session-model > summary');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    model: rect(model),
    modelText: summary?.textContent?.trim() ?? null,
    modelOpen: model?.open ?? null,
    scroll: scroll ? { rect: rect(scroll), top: Math.round(scroll.scrollTop), height: scroll.scrollHeight } : null,
    composer: rect(composer),
    transcriptVisible: scroll ? scroll.getBoundingClientRect().height > 120 : false,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    selects: [...document.querySelectorAll('.session-model select')].map((select) => ({ value: select.value, rect: rect(select) })),
    insideView: model ? model.getBoundingClientRect().top >= 0 && model.getBoundingClientRect().bottom <= window.innerHeight : false,
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
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});

await sleep(5500);

const result = {};
result.answered = await evaluate(
  `(() => {
    const option = document.querySelector('.questions .option');
    if (!option) return 'no-question';
    option.click();
    const submit = document.querySelector('.questions .question-batch > button');
    submit?.click();
    return 'answered';
  })()`,
);
await sleep(900);

await evaluate(
  `(() => { const rows = [...document.querySelectorAll('.session-open')]; const row = rows.find((item) => item.textContent.includes('Restaurar la caché')); row?.click(); })()`,
);
await sleep(3000);

result.opened = await evaluate(metrics);
await shot('model-01-conversation-bottom');

result.scrolledToTop = await evaluate(
  `(() => { const area = document.querySelector('.session-scroll'); area.scrollTop = 0; return area.scrollTop; })()`,
);
await sleep(300);
result.atTop = await evaluate(metrics);
await shot('model-02-conversation-top');

result.backToBottom = await evaluate(
  `(() => { const area = document.querySelector('.session-scroll'); area.scrollTop = area.scrollHeight; return area.scrollTop; })()`,
);
await sleep(300);

result.expanded = await evaluate(
  `(() => { const summary = document.querySelector('.session-model > summary'); summary?.click(); return Boolean(document.querySelector('.session-model')?.open); })()`,
);
await sleep(400);
result.afterExpand = await evaluate(metrics);
await shot('model-03-expanded');

result.changed = await evaluate(
  `(() => {
    const select = document.querySelector('.session-model select');
    if (!select) return false;
    const target = [...select.options].find((option) => option.value === '1');
    if (!target) return false;
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`,
);
await sleep(800);
result.afterChange = await evaluate(metrics);

await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 500,
  deviceScaleFactor: 2,
  mobile: true,
});
await sleep(500);
result.shortViewport = await evaluate(metrics);
await shot('model-04-short');

writeFileSync(`${outDir}/model.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
