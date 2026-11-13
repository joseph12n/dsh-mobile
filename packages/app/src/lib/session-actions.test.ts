import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionError } from './connection.js';
import { answer, connected, flush, lastSent, restoreSocket, stubSocket } from './test-socket.js';

/**
 * Las acciones de la sesión sobre el contrato.
 *
 * Lo que se fija aquí es que el cliente **no dé por bueno cualquier marco**: una
 * confirmación que no llegue, o que llegue con otro tipo, es un fallo, no un éxito.
 */

afterEach(() => {
  restoreSocket();
});

describe('crear una sesión', () => {
  it('manda el workspace y devuelve el id confirmado', async () => {
    stubSocket();
    const { socket, client } = await connected(['session.create']);

    const creating = client.createSession('ws-1');
    await flush();
    expect(lastSent(socket)).toMatchObject({ type: 'session.create', workspaceId: 'ws-1' });

    answer(socket, { type: 'session.created', sessionId: 'session-9' });
    await expect(creating).resolves.toBe('session-9');
  });

  it('propaga el código del host cuando la carpeta ya no está', async () => {
    stubSocket();
    const { socket, client } = await connected(['session.create']);

    const creating = client.createSession('gone');
    await flush();
    answer(socket, { type: 'error', code: 'not-found', message: 'gone' });

    await expect(creating).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rechaza una confirmación con otro tipo', async () => {
    // Un host que contesta `workspace.archived` a un `session.create` no ha creado nada.
    stubSocket();
    const { socket, client } = await connected(['session.create']);

    const creating = client.createSession('ws-1');
    await flush();
    answer(socket, { type: 'workspace.archived', sessionId: 'session-9' });

    await expect(creating).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe('archivar una sesión', () => {
  it('resuelve cuando el host confirma', async () => {
    stubSocket();
    const { socket, client } = await connected(['workspace.archive']);

    const archiving = client.archiveSession('session-1');
    await flush();
    expect(lastSent(socket)).toMatchObject({ type: 'workspace.archive', sessionId: 'session-1' });

    answer(socket, { type: 'workspace.archived', sessionId: 'session-1' });
    await expect(archiving).resolves.toBeUndefined();
  });

  it('propaga `denied`, que es la negativa por trabajo en marcha', async () => {
    stubSocket();
    const { socket, client } = await connected(['workspace.archive']);

    const archiving = client.archiveSession('session-1');
    await flush();
    answer(socket, { type: 'error', code: 'denied', message: 'busy' });

    await expect(archiving).rejects.toMatchObject({ code: 'denied' });
  });

  it('rechaza cualquier respuesta que no sea la confirmación', async () => {
    // El fallo silencioso: antes se aceptaba cualquier marco que no fuera `error`.
    stubSocket();
    const { socket, client } = await connected(['workspace.archive']);

    const archiving = client.archiveSession('session-1');
    await flush();
    answer(socket, { type: 'sessions.ok', sessions: [] });

    await expect(archiving).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe('archivadas', () => {
  it('pide la lista con las archivadas cuando se le dice', async () => {
    stubSocket();
    const { socket, client } = await connected();

    const listing = client.listSessions(true);
    await flush();
    expect(lastSent(socket)).toMatchObject({ type: 'sessions.list', includeArchived: true });

    answer(socket, { type: 'sessions.ok', sessions: [] });
    await expect(listing).resolves.toEqual([]);
  });

  it('no manda la clave cuando no se piden', async () => {
    stubSocket();
    const { socket, client } = await connected();

    const listing = client.listSessions();
    await flush();
    expect('includeArchived' in lastSent(socket)).toBe(false);

    answer(socket, { type: 'sessions.ok', sessions: [] });
    await listing;
  });

  it('propaga el not-found al restaurar', async () => {
    stubSocket();
    const { socket, client } = await connected(['workspace.unarchive']);

    const restoring = client.unarchive('gone');
    await flush();
    answer(socket, { type: 'error', code: 'not-found', message: 'gone' });

    await expect(restoring).rejects.toMatchObject({ code: 'not-found' });
  });

  it('restaura y exige la confirmación', async () => {
    stubSocket();
    const { socket, client } = await connected(['workspace.unarchive']);

    const restoring = client.unarchive('session-1');
    await flush();
    expect(lastSent(socket)).toMatchObject({
      type: 'workspace.unarchive',
      sessionId: 'session-1',
    });

    answer(socket, { type: 'workspace.unarchived', sessionId: 'session-1' });
    await expect(restoring).resolves.toBeUndefined();
  });

  it('rechaza una respuesta que no sea la confirmación', async () => {
    stubSocket();
    const { socket, client } = await connected(['workspace.unarchive']);

    const restoring = client.unarchive('session-1');
    await flush();
    answer(socket, { type: 'sessions.ok', sessions: [] });

    await expect(restoring).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe('modelos', () => {
  const catalog = {
    default: { provider: 'deepseek', model: 'chat' },
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }],
    failures: [],
  };

  it('lee el catálogo', async () => {
    stubSocket();
    const { socket, client } = await connected(['model.select']);

    const listing = client.listModels();
    await flush();
    answer(socket, { type: 'models.ok', catalog });

    await expect(listing).resolves.toEqual(catalog);
  });

  it('trata bad-request como "sin modelos", no como fallo', async () => {
    stubSocket();
    const { socket, client } = await connected();

    const listing = client.listModels();
    await flush();
    answer(socket, { type: 'error', code: 'bad-request', message: 'no' });

    await expect(listing).resolves.toEqual({ groups: [], failures: [] });
  });

  it('manda el esfuerzo solo cuando existe y devuelve el normalizado', async () => {
    stubSocket();
    const { socket, client } = await connected(['model.select']);

    const choosing = client.selectModel('session-1', {
      provider: 'deepseek',
      model: 'chat',
      reasoningEffort: 'high',
    });
    await flush();
    expect(lastSent(socket)).toMatchObject({
      type: 'model.select',
      sessionId: 'session-1',
      provider: 'deepseek',
      model: 'chat',
      reasoningEffort: 'high',
    });

    answer(socket, {
      type: 'model.selected',
      sessionId: 'session-1',
      selection: { provider: 'deepseek', model: 'chat' },
    });
    await expect(choosing).resolves.toEqual({ provider: 'deepseek', model: 'chat' });
  });

  it('no manda la clave del esfuerzo cuando no hay', async () => {
    stubSocket();
    const { socket, client } = await connected(['model.select']);

    const choosing = client.selectModel('session-1', { provider: 'p', model: 'm' });
    await flush();
    expect(lastSent(socket)).not.toHaveProperty('reasoningEffort');

    answer(socket, {
      type: 'model.selected',
      sessionId: 'session-1',
      selection: { provider: 'p', model: 'm' },
    });
    await choosing;
  });
});
