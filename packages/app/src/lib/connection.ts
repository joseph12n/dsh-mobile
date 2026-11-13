import {
  PROTOCOL_VERSION,
  WEBSOCKET_PATH,
  newMessageId,
  parseServerMessage,
  type ClientMessage,
  type DeviceInfo,
  type HistoryEntry,
  type HostInfo,
  type ModelCatalog,
  type ModelSelection,
  type QuestionAnswerItem,
  type ServerMessage,
  type SessionSummary,
  type Workspace,
} from '@dsh-mobile/protocol';

/**
 * Cliente del contrato sobre WebSocket.
 *
 * Sin dependencias: un socket, correlación por `id` y nada más. Toda la
 * validación la hace `@dsh-mobile/protocol`, así que cliente y host no pueden
 * interpretar los marcos de forma distinta.
 */

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; host: HostInfo; device: DeviceInfo | undefined }
  | { kind: 'offline'; reason: string };

/**
 * Fallo de conexión con el código del protocolo, cuando lo hay.
 *
 * La app necesita distinguir «el host no responde» de «este token ya no vale»:
 * lo primero se reintenta, lo segundo solo se arregla volviendo a emparejar.
 */
export class ConnectionError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
  }
}

/** Fallo al canjear un código de emparejamiento. */
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

/**
 * `Omit` sobre una unión colapsa a las claves comunes, así que hay que
 * distribuirla: queremos quitar el sobre a **cada** miembro por separado.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Un mensaje del cliente sin el sobre, que rellena `#request`. */
type OutgoingMessage = DistributiveOmit<ClientMessage, 'v' | 'id' | 'at'>;

/** URL del WebSocket a partir del origen donde se sirve la app. */
export function endpointFromLocation(): string {
  const scheme = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${globalThis.location.host}${WEBSOCKET_PATH}`;
}

/** Normaliza lo que el usuario escribe como endpoint. */
export function normalizeEndpoint(raw: string): string {
  const value = raw.trim();
  if (!value) return endpointFromLocation();
  if (/^wss?:\/\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value.replace(/^http/i, 'ws');
  return `ws://${value.replace(/^\/+/, '')}`;
}

const REQUEST_TIMEOUT_MS = 10_000;

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

  /**
   * Escucha los mensajes que el host empuja sin que nadie los pida, como
   * `question.pending` o `question.settled`. Las respuestas a peticiones viajan
   * por su promesa y no llegan aquí.
   */
  onPush(listener: (message: ServerMessage) => void): void {
    this.#onPush = listener;
  }

  /** Abre el socket. Resuelve cuando el `hello.ok` llega. */
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

      // Ni un cierre pedido por la app ni un rechazo del host son una caída: no
      // deben disparar reintentos.
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
      // El socket se cierra a continuación. Se marca como cierre propio para que
      // onclose no lo anuncie como caída: si lo hiciera, el reintento pisaría la
      // decisión de quien lanzó (un proto-unsupported acababa reintentando siempre).
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

  /** Canjea un código de emparejamiento. Debe llamarse tras `connect()` sin token. */
  async pair(code: string, deviceName: string, platform: string): Promise<PairResult> {
    const response = await this.#request({ type: 'pair.redeem', code, deviceName, platform });

    // Un código inválido no se arregla reintentando: la app tiene que poder
    // distinguirlo para devolver el formulario en vez de reintentar sin el código.
    if (response.type === 'error') throw new PairingError(response.message, response.code);
    if (response.type !== 'pair.ok') {
      throw new PairingError(`Respuesta inesperada: ${response.type}`);
    }

    this.#onState({ kind: 'connected', host: response.host, device: response.device });
    return { deviceToken: response.deviceToken, device: response.device, host: response.host };
  }

  /**
   * Folders of the desktop.
   *
   * A host that does not implement `workspace.list` answers `bad-request`; that is not a
   * failure, it means "no folders", and the caller renders a flat list. Only other error
   * codes propagate.
   */
  /** What this host said it can do. */
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

  /**
   * Creates a session inside an existing folder.
   *
   * The host decides whether the folder exists: `not-found` is its answer, not a guess
   * made here from a list that may be stale.
   */
  async createSession(workspaceId: string): Promise<string> {
    const response = await this.#request({ type: 'session.create', workspaceId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'session.created') {
      throw new ConnectionError('The host did not confirm the session.', 'internal');
    }
    return response.sessionId;
  }

  /**
   * Archives a session.
   *
   * The "session has work running" refusal arrives as `denied`, so the caller can offer
   * "stop it first" instead of killing a running turn from a phone without asking. The
   * response is checked like every other one: a frame that is not `workspace.archived`
   * is a failure, not a success.
   */
  async archiveSession(sessionId: string): Promise<void> {
    const response = await this.#request({ type: 'workspace.archive', sessionId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'workspace.archived') {
      throw new ConnectionError('The host did not confirm the archive.', 'internal');
    }
  }

  /**
   * Lists the sessions.
   *
   * `includeArchived` brings the archived ones back, marked with `archived: true`: without
   * it the list is the everyday one, where an archived session has no business.
   */
  async listSessions(includeArchived = false): Promise<SessionSummary[]> {
    const response = await this.#request({
      type: 'sessions.list',
      ...(includeArchived ? { includeArchived: true } : {}),
    });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    return response.type === 'sessions.ok' ? response.sessions : [];
  }

  /** Brings an archived session back into the list. */
  async unarchive(sessionId: string): Promise<void> {
    const response = await this.#request({ type: 'workspace.unarchive', sessionId });
    if (response.type === 'error') throw new ConnectionError(response.message, response.code);
    if (response.type !== 'workspace.unarchived') {
      throw new ConnectionError('The host did not confirm the restore.', 'internal');
    }
  }

  /**
   * The host's model catalog.
   *
   * A host that does not implement `models.list` answers `bad-request`: that means
   * "nothing to offer", not a failure. An empty catalog is a valid answer too.
   */
  async listModels(): Promise<ModelCatalog> {
    const response = await this.#request({ type: 'models.list' });

    if (response.type === 'error') {
      if (response.code === 'bad-request') return { groups: [], failures: [] };
      throw new ConnectionError(response.message, response.code);
    }

    return response.type === 'models.ok' ? response.catalog : { groups: [], failures: [] };
  }

  /**
   * Changes the model of one session.
   *
   * Returns the selection the host normalized, so the UI shows what will actually
   * run rather than what was asked for.
   */
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

  /** Responde un lote completo. El host rechaza un lote parcial. */
  async answer(callId: string, sessionId: string, answers: QuestionAnswerItem[]): Promise<void> {
    const response = await this.#request({ type: 'question.answer', callId, sessionId, answers });
    if (response.type === 'error') throw new Error(response.message);
  }

  /** Página de historial. Sin `before`, la más reciente. */
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

  /** Se suscribe a los eventos de una sesión. Los eventos llegan por `onPush`. */
  async subscribe(sessionId: string, since?: number): Promise<number> {
    const response = await this.#request({
      type: 'session.subscribe',
      sessionId,
      ...(since !== undefined ? { since } : {}),
    });
    if (response.type === 'error') throw new Error(response.message);
    return response.type === 'session.ok' ? response.seq : 0;
  }

  /** Cancela el turno en curso. */
  async cancel(sessionId: string): Promise<void> {
    const response = await this.#request({ type: 'run.cancel', sessionId });
    if (response.type === 'error') throw new Error(response.message);
  }

  /** Escribe en la sesión. El host confirma la aceptación, no la posición. */
  async reply(sessionId: string, text: string): Promise<void> {
    const response = await this.#request({ type: 'reply.send', sessionId, text });
    if (response.type === 'error') throw new Error(response.message);
  }

  /**
   * `true` cuando el host contestó con un marco de error.
   *
   * Un rechazo del host no es una caída: el cierre que viene detrás no debe
   * anunciarse como pérdida, o el reintento pisaría la decisión de quien lo
   * recibió (un `proto-unsupported` acababa reintentando para siempre).
   */
  #hostRejected = false;

  /** `true` mientras el cierre lo pide la propia app. */
  #intentionalClose = false;

  /**
   * `true` una vez el host aceptó el `hello`.
   *
   * Separa un **rechazo durante el handshake** —donde el cierre que viene detrás no
   * es una caída y no debe reintentarse— de un error cualquiera en una conexión ya
   * establecida. Sin esto la bandera era pegajosa por socket: tras un `rate-limited`
   * el socket podía caerse de verdad y nadie reintentaba, con la transcripción
   * congelada y sin síntoma.
   */
  #handshakeDone = false;

  /** Capabilities announced by the host at `hello.ok`. Empty until connected. */
  #capabilities: string[] = [];

  close(): void {
    this.#failAll(new Error('Conexión cerrada.'));
    // Marcado antes de cerrar: onclose no debe confundir un cierre pedido con
    // una caída, o la app programaría un reintento que mataría la conexión nueva.
    this.#intentionalClose = true;
    this.#socket?.close();
    this.#socket = undefined;
    this.#onState({ kind: 'idle' });
  }

  /** Envía una petición y espera la respuesta con el mismo `id`. */
  #request(payload: OutgoingMessage): Promise<ServerMessage> {
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
      }, REQUEST_TIMEOUT_MS);

      this.#pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify(message));
    });
  }

  #receive(raw: string): void {
    const message = parseServerMessage(raw);
    if (!message) return;

    // Antes de resolver: el cierre puede llegar en el mismo tick y la carrera hacía
    // que se anunciara como caída. Solo durante el handshake: más tarde un error es
    // una respuesta normal y la caída posterior sí debe reintentarse.
    if (message.type === 'error' && !this.#handshakeDone) this.#hostRejected = true;

    const pending = this.#pending.get(message.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      pending.resolve(message);
      return;
    }

    // Sin petición que lo espere: es un envío espontáneo del host.
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
