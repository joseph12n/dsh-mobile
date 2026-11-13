import { appendFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 6768);
const code = process.argv[3];
const outFile = process.argv[4] ?? 'tools/preview/out/live-probe.jsonl';
const seconds = Number(process.argv[5] ?? 150);

writeFileSync(outFile, '');

const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
let seq = 0;

function frame(type, extra = {}) {
  seq += 1;
  socket.send(JSON.stringify({ v: 1, id: `probe-${seq}`, at: Date.now(), type, ...extra }));
}

function record(event, data = {}) {
  appendFileSync(outFile, `${JSON.stringify({ t: new Date().toISOString(), event, ...data })}\n`);
}

socket.on('open', () => {
  record('open');
  frame('hello', { proto: 1 });
});

socket.on('message', (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    record('unparseable');
    return;
  }

  if (message.type === 'hello.ok') {
    record('hello.ok', { capabilities: message.host?.capabilities ?? [] });
    frame('pair.redeem', { code, deviceName: 'live-probe', platform: 'node' });
    return;
  }

  if (message.type === 'pair.ok') {
    record('pair.ok', { tokenLength: message.deviceToken?.length ?? 0 });
    return;
  }

  if (message.type === 'question.pending') {
    record('question.pending', {
      callId: message.question?.callId,
      sessionId: message.question?.sessionId,
      text: message.question?.items?.[0]?.text,
    });
    return;
  }

  if (message.type === 'error') {
    record('error', { code: message.code, message: message.message });
    return;
  }

  record('recv', { type: message.type });
});

socket.on('error', (error) => {
  record('socket-error', { message: String(error) });
});

const tick = setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) {
    record('send', { type: 'sessions.list' });
    frame('sessions.list');
    void probeReport();
  }
}, 3000);

async function probeReport() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/probe`);
    const report = await response.json();
    const active = (report.sessions ?? [])
      .map((session) => ({
        id: session.id,
        active: Array.isArray(session.pendingQuestions?.active)
          ? session.pendingQuestions.active.length
          : 0,
      }))
      .filter((entry) => entry.active > 0);
    record('probe', { active });
  } catch (error) {
    record('probe-error', { message: String(error) });
  }
}

setTimeout(() => {
  clearInterval(tick);
  record('stop');
  socket.close();
  process.exit(0);
}, seconds * 1000);
