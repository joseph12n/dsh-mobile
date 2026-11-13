import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 6768);
const code = process.argv[3];
const sessionId = process.argv[4];

const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
let seq = 0;

function frame(type, extra = {}) {
  seq += 1;
  socket.send(JSON.stringify({ v: 1, id: `probe-${seq}`, at: Date.now(), type, ...extra }));
}

const timer = setTimeout(() => {
  console.log(JSON.stringify({ error: 'timeout' }));
  socket.close();
  process.exit(1);
}, 15000);

socket.on('open', () => frame('hello', { proto: 1 }));

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());

  if (message.type === 'hello.ok') {
    frame('pair.redeem', { code, deviceName: 'history-probe', platform: 'node' });
    return;
  }

  if (message.type === 'pair.ok') {
    frame('session.history', { sessionId, limit: 40 });
    return;
  }

  if (message.type === 'history.ok') {
    const entries = message.entries ?? [];
    const messages = entries.filter((entry) => entry.event?.kind === 'message');
    const withReasoning = messages.filter((entry) => Boolean(entry.event?.reasoning));
    const internal = messages.filter(
      (entry) =>
        entry.event?.role === 'user' &&
        /Time sampled|background job|runtime context|agent-instructions/i.test(
          entry.event?.text ?? '',
        ),
    );
    const report = {
      total: entries.length,
      messages: messages.length,
      withReasoning: withReasoning.length,
      sample: withReasoning.slice(0, 2).map((entry) => ({
        seq: entry.seq,
        text: entry.event.text.slice(0, 120),
        reasoning: entry.event.reasoning.slice(0, 160),
      })),
      internalUserMessages: internal.length,
    };
    console.log(JSON.stringify(report, null, 2));
    clearTimeout(timer);
    socket.close();
    process.exit(0);
  }

  if (message.type === 'error') {
    console.log(JSON.stringify({ error: message.code, message: message.message }));
    clearTimeout(timer);
    socket.close();
    process.exit(1);
  }
});
