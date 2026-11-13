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
  const body = document.querySelector('.shell-body');
  const bodyTop = body ? Math.round(body.getBoundingClientRect().top) : null;
  const folders = [...document.querySelectorAll('.group.folder')].map((section) => {
    const head = section.querySelector('.folder-head');
    const toggle = section.querySelector('.folder-toggle');
    const icon = section.querySelector('.folder-icon');
    const name = section.querySelector('.folder-name');
    const path = section.querySelector('.folder-path');
    const list = section.querySelector('ul.sessions');
    return {
      name: name?.textContent ?? null,
      path: path?.textContent ?? null,
      count: section.querySelector('.count')?.textContent ?? null,
      expanded: toggle?.getAttribute('aria-expanded') ?? null,
      controls: toggle?.getAttribute('aria-controls') ?? null,
      accent: getComputedStyle(section).getPropertyValue('--folder-accent').trim(),
      iconColor: icon ? getComputedStyle(icon).color : null,
      rail: list ? getComputedStyle(list).borderLeftColor : null,
      headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
      headBottom: head ? Math.round(head.getBoundingClientRect().bottom) : null,
      hasList: Boolean(list),
      rows: list ? list.querySelectorAll('.session-row').length : 0,
    };
  });
  return {
    viewport: { w: innerWidth, h: innerHeight },
    body: body ? { top: bodyTop, scrollTop: Math.round(body.scrollTop), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null,
    folders,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    stored: localStorage.getItem('dsh-mobile.folders'),
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
    document.querySelector('.questions .question-batch > button')?.click();
    return 'answered';
  })()`,
);
await sleep(900);

result.top = await evaluate(metrics);
await shot('folders-01-top');

result.scrolled = await evaluate(
  `(() => { const body = document.querySelector('.shell-body'); body.scrollTop = 420; return body.scrollTop; })()`,
);
await sleep(400);
result.afterScroll = await evaluate(metrics);
await shot('folders-02-sticky');

result.collapsed = await evaluate(
  `(() => { const toggle = document.querySelector('.group.folder .folder-toggle'); toggle?.click(); return Boolean(toggle); })()`,
);
await sleep(400);
result.afterCollapse = await evaluate(metrics);
await shot('folders-03-collapsed');

result.expandAgain = await evaluate(
  `(() => { const toggle = document.querySelector('.group.folder .folder-toggle'); toggle?.click(); return toggle?.getAttribute('aria-expanded') ?? null; })()`,
);
await sleep(400);
result.afterExpand = await evaluate(metrics);

result.backToTop = await evaluate(
  `(() => { const body = document.querySelector('.shell-body'); body.scrollTop = 0; return body.scrollTop; })()`,
);
await sleep(300);
await shot('folders-04-expanded-top');

writeFileSync(`${outDir}/folders.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
