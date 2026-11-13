import WebSocket from 'ws';

const port = process.argv[2] ?? '9222';
const steps = Number(process.argv[3] ?? 12);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((target) => target.type === 'page' && target.url.includes('127.0.0.1'));
if (!page) throw new Error('no app page');

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 16 * 1024 * 1024 });
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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const sequence = [];
for (let step = 0; step < steps; step += 1) {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));

  const result = await send('Runtime.evaluate', {
    expression: `(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        className: String(element.className).slice(0, 40),
        text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 32),
        focusVisible: element.matches(':focus-visible'),
        outline: style.outlineStyle + ' ' + style.outlineWidth,
      };
    })()`,
    returnByValue: true,
  });
  sequence.push(result.result.value);
}

console.log(JSON.stringify(sequence, null, 2));
ws.close();
