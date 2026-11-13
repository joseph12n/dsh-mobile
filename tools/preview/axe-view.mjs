import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const outDir = process.argv[2] ?? '.';
const debugPort = process.argv[3] ?? '9222';
const pairUrl = process.argv[4];
const mode = process.argv[5] ?? 'list';

const axeSource = readFileSync(new URL('./axe.min.js', import.meta.url), 'utf8');

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

let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function send(method, params = {}) {
  const mine = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mine, (message) => {
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

if (mode === 'conversation') {
  await send('Runtime.evaluate', {
    expression: `(() => {
      const option = document.querySelector('.questions .option');
      option?.click();
      document.querySelector('.questions .question-batch > button')?.click();
    })()`,
  });
  await sleep(900);
  await send('Runtime.evaluate', {
    expression: `(() => {
      const rows = [...document.querySelectorAll('.session-open')];
      rows.find((row) => row.textContent.includes('Restaurar la caché'))?.click();
    })()`,
  });
  await sleep(2500);
} else if (mode !== 'list') {
  await send('Runtime.evaluate', {
    expression: `document.querySelector('.head .head-action').click()`,
  });
  await sleep(600);
}

await send('Runtime.evaluate', { expression: axeSource });
await sleep(300);

const result = await send('Runtime.evaluate', {
  expression: `axe.run(document, { resultTypes: ['violations'] }).then((report) => ({
    violations: report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 6).map((node) => ({ target: node.target, summary: node.failureSummary })),
    })),
    passes: report.passes.length,
    incomplete: report.incomplete.map((item) => item.id),
  }))`,
  returnByValue: true,
  awaitPromise: true,
});

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${outDir}/axe-${mode}.png`, Buffer.from(data, 'base64'));

console.log(JSON.stringify(result.result.value, null, 2));
ws.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);
