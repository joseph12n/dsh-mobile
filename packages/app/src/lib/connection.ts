import {
  PROTOCOL_VERSION,
  WEBSOCKET_PATH,
  newMessageId,
  parseServerMessage,
  type ClientMessage,
  type CommandInfo,
  type CommandResult,
  type DeviceInfo,
  type HistoryEntry,
  type HostInfo,
  type ModelCatalog,
  type ModelSelection,
  type ProviderConnection,
  type ProviderTestResult,
  type ProviderView,
  type QuestionAnswerItem,
  type ServerMessage,
  type SessionActivity,
  type SessionSummary,
  type Workspace,
} from '@deepseekharness-mobile/protocol';

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; host: HostInfo; device: DeviceInfo | undefined }
  | { kind: 'offline'; reason: string };

export class ConnectionError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
  }
}

export class PairingError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PairingError';
    this.code = code;
  }
}

export interface PairResult {
  deviceToken: string;
  device: DeviceInfo;
  host: HostInfo;
}

type Pending = {
  resolve: (value: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type OutgoingMessage = DistributiveOmit<ClientMessage, 'v' | 'id' | 'at'>;

export function endpointFromLocation(): string {
  const scheme = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${globalThis.location.host}${WEBSOCKET_PATH}`;
}

export function normalizeEndpoint(raw: string): string {
  const value = raw.trim();
  if (!value) return endpointFromLocation();
  if (/^wss?:\/\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value.replace(/^http/i, 'ws');
  return `ws://${value.replace(/^\/+/, '')}`;
}

const REQUEST_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 120_000;

export class CompanionClient {
  readonly #url: string;
  #socket: WebSocket | undefined;
  #pending = new Map<string, Pending>();
  #onState: (state: ConnectionState) => void = () => undefined;
  #onPush: (message: ServerMessage) => void = () => undefined;

  constructor(url: string) {
    this.#url = url;
  }

  get url(): string {
    return this.#url;
  }

  onState(listener: (state: ConnectionState) => void): void {
    this.#onState = listener;
  }

  onPush(listener: (message: ServerMessage) => void): void {
    this.#onPush = listener;
  }

  async connect(deviceToken?: string): Promise<{ host: HostInfo; device?: DeviceInfo }> {
    this.#onState({ kind: 'connecting' });

    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout conectando.')), REQUEST_TIMEOUT_MS);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error('No pude abrir el WebSocket.'));
      };
    });

    socket.onmessage = (event: MessageEvent<string>) => this.#receive(event.data);
    socket.onclose = () => {
      const reason = 'El host cerró la conexión.';
      this.#failAll(new Error(reason));

      if (!this.#intentionalClose && !this.#hostRejected) {
        this.#onState({ kind: 'offline', reason });
      }
    };
    socket.onerror = () => this.#failAll(new Error('Error de WebSocket.'));

    const response = await this.#request({
      type: 'hello',
      proto: PROTOCOL_VERSION,
      ...(deviceToken ? { deviceToken } : {}),
    });

    if (response.type === 'error') {
      this.#intentionalClose = true;
      throw new ConnectionError(response.message, response.code);
    }

    if (response.type !== 'hello.ok') {
      throw new Error(`Respuesta inesperada: ${response.type}`);
    }

    this.#handshakeDone = true;
    this.#capabilities = [...response.host.capabilities];
    this.#onState({ kind: 'connected', host: response.host, device: response.device });
    return { host: response.host, ...(response.device ? { device: response.device } : {}) };
  }

  async pair(code: string, deviceName: string, platform: string): Promise<PairResult> {
    const response = await this.#request({ type: 'pair.redeem', code, deviceName, platform });

    if (response.type === 'error') throw new PairingError(response.message, response.code);
    if (response.type !== 'pair.ok') {
      throw new PairingError(`Respuesta inesperada: ${response.type}`);
    }

    this.#onState({ kind: 'connected', host: response.host, device: response.device });
    return { deviceToken: response.deviceToken, device: response.device, host: response.host };
  }

  capabilities(): readonly string[] {
    return this.#capabilities;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const response = await this.#request({ type: 'workspace.list' });

    if (response.type === 'error') {
      if (response.code === 'bad-request') return [];
      throw new ConnectionError(response.message, response.code);
    }

    return response.type === 'workspace.ok' ? response.workspaces : [];
  }

  async createSession(workspaceId: string): Promise<string> {
    const response = await this.#request({ type: 'session.create', workspaceId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'session.created') {
      throw new ConnectionError('The host did not confirm the session.', 'internal');
    }
    return response.sessionId;
  }

  async archiveSession(sessionId: string): Promise<void> {
    const response = await this.#request({ type: 'workspace.archive', sessionId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'workspace.archived') {
      throw new ConnectionError('The host did not confirm the archive.', 'internal');
    }
  }

  async listSessions(includeArchived = false): Promise<SessionSummary[]> {
    const response = await this.#request({
      type: 'sessions.list',
      ...(includeArchived ? { includeArchived: true } : {}),
    });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    return response.type === 'sessions.ok' ? response.sessions : [];
  }

  async unarchive(sessionId: string): Promise<void> {
    const response = await this.#request({ type: 'workspace.unarchive', sessionId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'workspace.unarchived') {
      throw new ConnectionError('The host did not confirm the restore.', 'internal');
    }
  }

  async listModels(): Promise<ModelCatalog> {
    const response = await this.#request({ type: 'models.list' });

    if (response.type === 'error') {
      if (response.code === 'bad-request') return { groups: [], failures: [] };
      throw new ConnectionError(response.message, response.code);
    }

    return response.type === 'models.ok' ? response.catalog : { groups: [], failures: [] };
  }

  async selectModel(sessionId: string, selection: ModelSelection): Promise<ModelSelection> {
    const response = await this.#request({
      type: 'model.select',
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    });

    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'model.selected') {
      throw new ConnectionError('The host did not confirm the model.', 'internal');
    }
    return response.selection;
  }

  async answer(callId: string, sessionId: string, answers: QuestionAnswerItem[]): Promise<void> {
    const response = await this.#request({ type: 'question.answer', callId, sessionId, answers });
    if (response.type === 'error') throw new Error(response.message);
  }

  async listCommands(sessionId: string): Promise<CommandInfo[]> {
    const response = await this.#request({ type: 'commands.list', sessionId });
    if (response.type === 'error') {
      if (response.code === 'bad-request') return [];
      throw new ConnectionError(response.message, response.code);
    }
    return response.type === 'commands.ok' ? response.commands : [];
  }

  async runCommand(sessionId: string, line: string): Promise<CommandResult> {
    const response = await this.#request(
      { type: 'command.run', sessionId, line },
      COMMAND_TIMEOUT_MS,
    );
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'command.ok') {
      throw new ConnectionError('The host did not confirm the command.', 'internal');
    }
    return {
      kind: response.kind,
      ...(response.text !== undefined ? { text: response.text } : {}),
    };
  }

  async activity(sessionId: string): Promise<SessionActivity> {
    const response = await this.#request({ type: 'session.activity', sessionId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    return response.type === 'activity.ok' ? response.activity : { subagents: [] };
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const response = await this.#request({ type: 'devices.list' });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    return response.type === 'devices.ok' ? response.devices : [];
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const response = await this.#request({ type: 'devices.revoke', deviceId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'devices.revoked') {
      throw new ConnectionError('The host did not confirm the revocation.', 'internal');
    }
  }

  async listProviders(): Promise<ProviderView[]> {
    const response = await this.#request({ type: 'providers.list' });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    return response.type === 'providers.ok' ? response.providers : [];
  }

  async testProvider(provider: string, apiKey: string): Promise<ProviderTestResult> {
    const response = await this.#request(
      { type: 'provider.test', provider, apiKey },
      COMMAND_TIMEOUT_MS,
    );
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    return response.type === 'provider.tested'
      ? {
          provider: response.provider,
          ok: response.ok,
          code: response.code,
          ...(response.detail ? { detail: response.detail } : {}),
        }
      : { provider, ok: false, code: 'unreachable' };
  }

  async connectProvider(provider: string, apiKey: string): Promise<ProviderConnection> {
    const response = await this.#request(
      { type: 'provider.connect', provider, apiKey },
      COMMAND_TIMEOUT_MS,
    );
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'provider.connected') {
      throw new ConnectionError('The host did not confirm the connection.', 'internal');
    }
    return {
      provider: response.provider,
      credential: response.credential,
      ...(response.credentialSource ? { credentialSource: response.credentialSource } : {}),
    };
  }

  async disconnectProvider(provider: string): Promise<ProviderConnection> {
    const response = await this.#request({ type: 'provider.disconnect', provider });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'provider.disconnected') {
      throw new ConnectionError('The host did not confirm the disconnection.', 'internal');
    }
    return {
      provider: response.provider,
      credential: response.credential,
      ...(response.credentialSource ? { credentialSource: response.credentialSource } : {}),
    };
  }

  async history(
    sessionId: string,
    options: { before?: number; limit?: number } = {},
  ): Promise<{ entries: HistoryEntry[]; hasMore: boolean }> {
    const response = await this.#request({
      type: 'session.history',
      sessionId,
      ...(options.before !== undefined ? { before: options.before } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
    if (response.type === 'error') throw new Error(response.message);
    return response.type === 'history.ok'
      ? { entries: response.entries, hasMore: response.hasMore }
      : { entries: [], hasMore: false };
  }

  async subscribe(sessionId: string, since?: number): Promise<number> {
    const response = await this.#request({
      type: 'session.subscribe',
      sessionId,
      ...(since !== undefined ? { since } : {}),
    });
    if (response.type === 'error') throw new Error(response.message);
    return response.type === 'session.ok' ? response.seq : 0;
  }

  async cancel(sessionId: string): Promise<void> {
    const response = await this.#request({ type: 'run.cancel', sessionId });
    if (response.type === 'error') throw new Error(response.message);
  }

  async reply(sessionId: string, text: string): Promise<void> {
    const response = await this.#request({ type: 'reply.send', sessionId, text });
    if (response.type === 'error') throw new Error(response.message);
  }

  #hostRejected = false;

  #intentionalClose = false;

  #handshakeDone = false;

  #capabilities: string[] = [];

  close(): void {
    this.#failAll(new Error('Conexión cerrada.'));
    this.#intentionalClose = true;
    this.#socket?.close();
    this.#socket = undefined;
    this.#onState({ kind: 'idle' });
  }

  #request(payload: OutgoingMessage, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ServerMessage> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Sin conexión con el host.'));
    }

    const id = newMessageId();
    const message = { ...payload, v: PROTOCOL_VERSION, id, at: Date.now() } as ClientMessage;

    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('El host no respondió a tiempo.'));
      }, timeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify(message));
    });
  }

  #receive(raw: string): void {
    const message = parseServerMessage(raw);
    if (!message) return;

    if (message.type === 'error' && !this.#handshakeDone) this.#hostRejected = true;

    const pending = this.#pending.get(message.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      pending.resolve(message);
      return;
    }

    this.#onPush(message);
  }

  #failAll(error: Error): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
