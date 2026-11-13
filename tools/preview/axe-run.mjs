import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const port = process.argv[2] ?? '9222';
const tags = process.argv[3] ?? 'wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa';

const axeSource = readFileSync(new URL('./axe.min.js', import.meta.url), 'utf8');

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === 'page' && target.url.includes('127.0.0.1'));
if (!page) throw new Error('no app page');

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

let id = 0;
function send(method, params = {}) {
  const mine = ++id;
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== mine) return;
      ws.off('message', handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
}

await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Runtime.evaluate', { expression: axeSource });
await new Promise((resolve) => setTimeout(resolve, 300));

const result = await send('Runtime.evaluate', {
  expression: `axe.run(document, {
    runOnly: { type: 'tag', values: ${JSON.stringify(tags.split(','))} },
    resultTypes: ['violations'],
  }).then((report) => ({
    violations: report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 5).map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
    passes: report.passes.length,
  }))`,
  returnByValue: true,
  awaitPromise: true,
});

console.log(JSON.stringify(result.result.value, null, 2));
ws.close();
