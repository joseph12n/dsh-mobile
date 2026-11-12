import { afterEach, describe, expect, it } from 'vitest';
import { CompanionClient, type ConnectionState } from './connection.js';
import { answer, connected, FakeSocket, flush, restoreSocket, stubSocket } from './test-socket.js';

/**
 * When a socket close counts as a **drop**.
 *
 * The bug this pins: any error frame marked the client as "rejected", and that mark
 * was sticky for the socket. After a `rate-limited` the socket could genuinely drop
 * and nobody retried — a frozen transcript with no symptom. A rejection only counts
 * while the handshake is in progress.
 */

afterEach(() => {
  restoreSocket();
});

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
  it('relays the folders the host sends', async () => {
    stubSocket();
    const { socket, client } = await connected(['workspace.list']);

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
    const { socket, client } = await connected();

    const listing = client.listWorkspaces();
    await flush();
    answer(socket, { type: 'error', code: 'bad-request', message: 'no' });

    await expect(listing).resolves.toEqual([]);
  });

  it('other errors do propagate', async () => {
    stubSocket();
    const { socket, client } = await connected();

    const listing = client.listWorkspaces();
    await flush();
    answer(socket, { type: 'error', code: 'internal', message: 'boom' });

    await expect(listing).rejects.toThrow();
  });

  it('the capabilities announced at hello are remembered', async () => {
    stubSocket();
    const { client } = await connected(['workspace.list']);
    expect(client.capabilities()).toEqual(['workspace.list']);
  });
});
