process.env.DSH_MOBILE_LOG_FILE = '0';

const { WebSocket } = await import('ws');
const { startCompanionServer } = await import('../../packages/companion/dist/server.js');
const { DeviceRegistry } = await import('../../packages/companion/dist/core/devices.js');
const { PairingService } = await import('../../packages/companion/dist/core/pairing.js');

const connections = Number(process.argv[2] ?? 50);
const payload = 'x'.repeat(60 * 1024);
const persistence = { load: () => [], save: () => undefined };
const devices = new DeviceRegistry({ persistence });
const { token } = devices.enroll('load-probe', 'node');
const server = await startCompanionServer({ pairing: new PairingService(), devices, port: 0 });
const url = `ws://127.0.0.1:${server.port}/ws`;

function hello(index) {
  return JSON.stringify({
    v: 1,
    id: `hello-${index}`,
    at: Date.now(),
    type: 'hello',
    proto: 1,
    deviceToken: token,
    clientName: payload,
  });
}

function open(index) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new WebSocket(url, { maxPayload: 1024 * 1024 });
    socket.on('open', () => socket.send(hello(index)));
    socket.on('message', () => {
      const latency = Date.now() - started;
      socket.close();
      resolve(latency);
    });
    socket.on('error', () => resolve(undefined));
  });
}

const latencies = (
  await Promise.all(Array.from({ length: connections }, (_, index) => open(index)))
)
  .filter((value) => value !== undefined)
  .sort((left, right) => left - right);
const average = latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length);

console.log(
  JSON.stringify(
    {
      connections,
      payloadBytes: payload.length,
      answered: latencies.length,
      averageMs: Math.round(average * 10) / 10,
      p95Ms: Math.round((latencies[Math.floor(latencies.length * 0.95)] ?? 0) * 10) / 10,
      maxMs: Math.round((latencies.at(-1) ?? 0) * 10) / 10,
    },
    null,
    2,
  ),
);

await server.close();
process.exit(0);
