import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 6768);
const titleNeedle = process.argv[3] ?? '';
const base = `http://127.0.0.1:${port}`;

const html = await (await fetch(`${base}/pair`)).text();
const code = html.match(/<code>([A-Z0-9]{8,})<\/code>/)?.[1];
if (!code) throw new Error('the /pair page carries no code');

const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
let seq = 0;
const pending = new Map();

function send(type, payload = {}) {
  seq += 1;
  const id = `probe-${seq}`;
  socket.send(JSON.stringify({ v: 1, id, at: Date.now(), type, ...payload }));
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout on ${type}`)), 15000);
  });
}

socket.on('open', () => {
  socket.send(JSON.stringify({ v: 1, id: 'hello', at: Date.now(), type: 'hello', proto: 1 }));
});

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  const key = message.replyTo ?? message.id;
  const resolve = key === undefined ? undefined : pending.get(key);
  if (resolve) {
    pending.delete(key);
    resolve(message);
  }
});

socket.on('error', (error) => {
  console.log(JSON.stringify({ step: 'socket', error: String(error) }));
});

const hello = await new Promise((resolve, reject) => {
  socket.once('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'hello.ok') resolve(message);
    else reject(new Error(`unexpected ${message.type}`));
  });
});

const capabilities = hello.host?.capabilities ?? [];
console.log(JSON.stringify({ step: 'hello', capabilities }));
if (!capabilities.includes('workspace.files')) {
  console.log(
    JSON.stringify({
      step: 'result',
      ok: false,
      reason: 'the host does not announce workspace.files',
    }),
  );
  process.exit(1);
}

const paired = await send('pair.redeem', { code, deviceName: 'files-probe', platform: 'node' });
const deviceId = paired.device?.id;

const listed = await send('sessions.list');
const sessions = listed.sessions ?? [];
const session =
  sessions.find((item) => item.title?.includes(titleNeedle)) ??
  sessions.find((item) => item.state === 'idle') ??
  sessions[0];
if (!session) throw new Error('no session to probe');

console.log(
  JSON.stringify({ step: 'session', id: session.id, title: session.title, total: sessions.length }),
);

const targets = [
  { path: 'docs/PRUEBA-VISOR.md', frame: 'file.read' },
  { path: 'MEMORIA.md', frame: 'file.read' },
  { path: 'README.md', frame: 'file.read' },
  { path: 'docs/assets/screenshots/03-conversation.png', frame: 'file.bytes' },
];

const results = [];
for (const target of targets) {
  const stat = await send('file.stat', { sessionId: session.id, path: target.path });
  const read = await send(target.frame, { sessionId: session.id, path: target.path });
  results.push({
    path: target.path,
    stat:
      stat.type === 'file.stat.ok'
        ? { ok: true, kind: stat.file?.kind, size: stat.file?.size }
        : { ok: false, code: stat.code, message: stat.message },
    read: read.type.endsWith('.ok')
      ? { ok: true, payload: read.text?.length ?? read.data?.length ?? 0 }
      : { ok: false, code: read.code, message: read.message },
  });
}

for (const result of results) console.log(JSON.stringify({ step: 'file', ...result }));

if (deviceId) await send('devices.revoke', { deviceId });
socket.close();

const good = results.filter((item) => item.stat.ok && item.read.ok).length;
console.log(
  JSON.stringify({ step: 'result', ok: good === results.length, good, total: results.length }),
);
process.exit(good === results.length ? 0 : 1);
