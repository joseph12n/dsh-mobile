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

const sheetState = `(() => {
  const sheet = document.querySelector('.sheet');
  const gear = document.querySelector('[aria-haspopup="dialog"]');
  const styles = sheet ? getComputedStyle(sheet) : null;
  return {
    historyState: history.state,
    open: Boolean(sheet?.open),
    display: styles?.display ?? null,
    translate: styles?.translate ?? null,
    transition: styles?.transitionProperty ?? null,
    heading: sheet?.querySelector('h2')?.textContent ?? null,
    sections: [...document.querySelectorAll('.sheet-section h3')].map((el) => el.textContent),
    active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
    gearExpanded: gear?.getAttribute('aria-expanded') ?? null,
    footer: Boolean(document.querySelector('.foot')),
    scrollHeight: sheet?.querySelector('.sheet-body')?.scrollHeight ?? null,
    clientHeight: sheet?.querySelector('.sheet-body')?.clientHeight ?? null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
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
result.list = await evaluate(sheetState);
await shot('set-00-list');

result.opened = await evaluate(
  `(() => { const gear = document.querySelector('[aria-haspopup="dialog"]'); if (!gear) return false; gear.click(); return true; })()`,
);
await sleep(500);
result.sheet = await evaluate(sheetState);
await shot('set-01-sheet');

result.folded = await evaluate(
  `(() => { const body = document.querySelector('.sheet-body'); if (!body) return null; body.scrollTop = body.scrollHeight; return { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight }; })()`,
);
await sleep(300);
await shot('set-02-sheet-bottom');

await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
  nativeVirtualKeyCode: 27,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Escape',
  code: 'Escape',
  windowsVirtualKeyCode: 27,
  nativeVirtualKeyCode: 27,
});
await sleep(600);
result.afterEscape = await evaluate(sheetState);

result.reopened = await evaluate(
  `(() => { const gear = document.querySelector('[aria-haspopup="dialog"]'); if (!gear) return false; gear.focus(); gear.click(); return true; })()`,
);
await sleep(500);
result.reopenedState = await evaluate(sheetState);

result.closedWithButton = await evaluate(
  `(() => { const close = document.querySelector('.sheet-head .icon-button'); if (!close) return false; close.click(); return true; })()`,
);
await sleep(600);
result.afterCloseButton = await evaluate(sheetState);
result.gearFocus = await evaluate(
  `(() => document.activeElement?.getAttribute('aria-haspopup') ?? null)()`,
);

await evaluate(`document.querySelector('[aria-haspopup="dialog"]').click()`);
await sleep(500);
await evaluate(`history.back()`);
await sleep(700);
result.afterHistoryBack = await evaluate(sheetState);
await shot('set-03-after-back');

await evaluate(`document.querySelector('[aria-haspopup="dialog"]').click()`);
await sleep(400);
result.contrastBefore = await evaluate(
  `(() => ({ attr: document.documentElement.dataset.contrast ?? null }))()`,
);
await shot('set-04-open-normal');
await evaluate(
  `(() => { const select = document.querySelectorAll('.sheet select')[1]; if (!select) return false; select.value = 'high'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
);
await sleep(400);
result.contrastAfter = await evaluate(
  `(() => ({ attr: document.documentElement.dataset.contrast ?? null }))()`,
);
await shot('set-05-contrast-high');

await evaluate(
  `(() => { const select = document.querySelectorAll('.sheet select')[1]; select.value = 'normal'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
);
await sleep(300);

await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
await evaluate(`document.querySelector('.sheet-head .icon-button').click()`);
await sleep(400);
await evaluate(`document.querySelector('[aria-haspopup="dialog"]').click()`);
await sleep(200);
result.reduced = await evaluate(sheetState);
await shot('set-06-reduced-motion');

writeFileSync(`${outDir}/settings.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
