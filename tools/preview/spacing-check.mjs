import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const outDir = process.argv[2] ?? '.';
const debugPort = process.argv[3] ?? '9222';
const pairUrl = process.argv[4];
const width = Number(process.argv[5] ?? 360);
const height = Number(process.argv[6] ?? 640);

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

const measure = `(() => {
  const rows = [...document.querySelectorAll('.sheet .settings-row')];
  const rects = rows.map((row) => {
    const label = row.querySelector('span');
    const control = row.querySelector('select, input');
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
    return { label: label?.textContent ?? null, row: box(row), control: box(control) };
  });
  const overlaps = [];
  for (let index = 0; index < rects.length; index += 1) {
    for (let other = index + 1; other < rects.length; other += 1) {
      const a = rects[index].row;
      const b = rects[other].row;
      if (a && b && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
        overlaps.push([rects[index].label, rects[other].label]);
      }
    }
  }
  const controlGaps = rects
    .map((item, index) => {
      const next = rects[index + 1];
      if (!item.control || !next?.control) return null;
      return { from: item.label, to: next.label, gap: next.control.top - item.control.bottom };
    })
    .filter((item) => item && item.gap < 40);
  const select = document.querySelector('.settings-row select');
  return {
    viewport: { w: innerWidth, h: innerHeight },
    rows: rects.length,
    overlaps,
    controlGaps,
    selectWidth: select ? Math.round(select.getBoundingClientRect().width) : null,
    labelWidth: rects.find((item) => item.label === 'Orden de carpetas')?.row
      ? Math.round(rects.find((item) => item.label === 'Orden de carpetas').row.right -
          rects.find((item) => item.label === 'Orden de carpetas').control.left)
      : null,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    sheetScroll: (() => { const body = document.querySelector('.sheet-body'); return body ? { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null; })(),
  };
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await sleep(5500);

await evaluate(`document.querySelector('.head .head-action')?.click()`);
await sleep(600);

const result = await evaluate(measure);
await shot(`spacing-${width}x${height}`);

console.log(JSON.stringify(result, null, 2));
ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
