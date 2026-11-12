import { afterEach, describe, expect, it } from 'vitest';
import { CompanionClient, type ConnectionState } from './connection.js';

/**
 * When a socket close counts as a **drop**.
 *
 * The bug this pins: any error frame marked the client as "rejected", and that mark
 * was sticky for the socket. After a `rate-limited` the socket could genuinely drop
 * and nobody retried — a frozen transcript with no symptom. A rejection only counts
 * while the handshake is in progress.
 */

/** Minimal stand-in for the browser WebSocket. */
class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | undefined;
  onmessage: ((event: { data: string }) => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Simulates the server accepting the socket. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Simulates a frame from the host. */
  deliver(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Simulates the host closing the socket. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const original = globalThis.WebSocket;

function stubSocket(): void {
  FakeSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = Object.assign(FakeSocket, {
    OPEN: 1,
  });
}

afterEach(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = original;
});

/** Lets the pending promise chain run: the client sends `hello` after `onopen`. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Replies to the pending request with the given frame. */
function answer(socket: FakeSocket, frame: Record<string, unknown>): void {
  const last = socket.sent.at(-1);
  if (!last) throw new Error('nothing was sent');
  const parsed = JSON.parse(last) as { id: string };
  socket.deliver({ v: 1, id: parsed.id, at: 1, ...frame });
}

describe('offline reporting', () => {
  it('reports a drop while the handshake is in progress', async () => {
    stubSocket();
    const states: ConnectionState[] = [];
    const client = new CompanionClient('ws://host/ws');
    client.onState((state) => states.push(state));

    const connecting = client.connect('token');
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await flush();
    answer(socket, {
      type: 'error',
      code: 'auth-invalid',
      message: 'no',
    });

    await expect(connecting).rejects.toThrow();
    socket.drop();

    expect(states.some((state) => state.kind === 'offline')).toBe(false);
  });

  it('does not mark a healthy connection as rejected by a later error', async () => {
    // The regression: this error used to make every subsequent drop silent.
    stubSocket();
    const states: ConnectionState[] = [];
    const client = new CompanionClient('ws://host/ws');
    client.onState((state) => states.push(state));

    const connecting = client.connect('token');
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await flush();
    answer(socket, {
      type: 'hello.ok',
      host: { id: 'h', name: 'n', version: '1', platform: 'p', capabilities: [] },
    });
    await connecting;

    // An ordinary error during the session, answered to a request.
    const listing = client.listSessions();
    await flush();
    answer(socket, { type: 'error', code: 'rate-limited', message: 'slow down' });
    await expect(listing).rejects.toThrow();

    // Now the socket really drops: this must be reported, or nobody retries.
    socket.drop();
    expect(states.some((state) => state.kind === 'offline')).toBe(true);
  });

  it('does not report a close the app asked for', async () => {
    stubSocket();
    const states: ConnectionState[] = [];
    const client = new CompanionClient('ws://host/ws');
    client.onState((state) => states.push(state));

    const connecting = client.connect('token');
    const socket = FakeSocket.instances[0]!;
    socket.open();
    await flush();
    answer(socket, {
      type: 'hello.ok',
      host: { id: 'h', name: 'n', version: '1', platform: 'p', capabilities: [] },
    });
    await connecting;

    client.close();

    expect(states.some((state) => state.kind === 'offline')).toBe(false);
  });
});

describe('asking for folders', () => {
  /** Connects a client to the fake socket and answers `hello.ok`. */
  async function connected(capabilities: string[] = []): Promise<FakeSocket> {
    const client = new CompanionClient('ws://host/ws');
    const connecting = client.connect('token');
    const socket = FakeSocket.instances.at(-1)!;
    socket.open();
    await flush();
    answer(socket, {
      type: 'hello.ok',
      host: { id: 'h', name: 'n', version: '1', platform: 'p', capabilities },
    });
    await connecting;
    (socket as unknown as { client: CompanionClient }).client = client;
    return socket;
  }

  it('relays the folders the host sends', async () => {
    stubSocket();
    const socket = await connected(['workspace.list']);
    const client = (socket as unknown as { client: CompanionClient }).client;

    const listing = client.listWorkspaces();
    await flush();
    answer(socket, {
      type: 'workspace.ok',
      workspaces: [{ id: 'w1', title: 't', directory: '/w/1', sessionIds: [] }],
    });

    await expect(listing).resolves.toHaveLength(1);
  });

  it('treats bad-request as "this host has no folders", not as a failure', async () => {
    // An older host without the handler answers this way; the list must stay flat
    // rather than showing an error.
    stubSocket();
    const socket = await connected();
    const client = (socket as unknown as { client: CompanionClient }).client;

    const listing = client.listWorkspaces();
    await flush();
    answer(socket, { type: 'error', code: 'bad-request', message: 'no' });

    await expect(listing).resolves.toEqual([]);
  });

  it('other errors do propagate', async () => {
    stubSocket();
    const socket = await connected();
    const client = (socket as unknown as { client: CompanionClient }).client;

    const listing = client.listWorkspaces();
    await flush();
    answer(socket, { type: 'error', code: 'internal', message: 'boom' });

    await expect(listing).rejects.toThrow();
  });

  it('the capabilities announced at hello are remembered', async () => {
    stubSocket();
    const socket = await connected(['workspace.list']);
    const client = (socket as unknown as { client: CompanionClient }).client;
    expect(client.capabilities()).toEqual(['workspace.list']);
  });
});
