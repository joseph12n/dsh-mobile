import { CompanionClient } from './connection.js';

/**
 * Un doble del WebSocket del navegador, compartido por las pruebas del cliente.
 *
 * Vive fuera de cualquier `.test.ts` para que dos archivos de pruebas no tengan que
 * copiarlo: una copia se queda atrás en cuanto el harness cambia.
 */
export class FakeSocket {
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

  /** Simula que el host acepta el socket. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Simula un marco del host. */
  deliver(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Simula que el host cierra el socket. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const originalWebSocket = globalThis.WebSocket;

/** Instala el doble y deja una lista limpia. */
export function stubSocket(): void {
  FakeSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = Object.assign(FakeSocket, {
    OPEN: 1,
  });
}

/** Devuelve el WebSocket global a su sitio. */
export function restoreSocket(): void {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
}

/** Deja correr la cadena pendiente: el cliente envía `hello` tras `onopen`. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Responde a la última petición enviada con el marco dado. */
export function answer(socket: FakeSocket, frame: Record<string, unknown>): void {
  const last = socket.sent.at(-1);
  if (!last) throw new Error('nothing was sent');
  const parsed = JSON.parse(last) as { id: string };
  socket.deliver({ v: 1, id: parsed.id, at: 1, ...frame });
}

/** El último marco que el cliente envió, ya parseado. */
export function lastSent(socket: FakeSocket): Record<string, unknown> {
  const last = socket.sent.at(-1);
  if (!last) throw new Error('nothing was sent');
  return JSON.parse(last) as Record<string, unknown>;
}

/** Un cliente ya emparejado contra el doble. */
export async function connected(
  capabilities: string[] = [],
): Promise<{ socket: FakeSocket; client: CompanionClient }> {
  const client = new CompanionClient('wss://host/ws');
  const connecting = client.connect('token');
  const socket = FakeSocket.instances.at(-1)!;
  socket.open();
  await flush();
  answer(socket, {
    type: 'hello.ok',
    host: { id: 'h', name: 'n', version: '1', platform: 'p', capabilities },
  });
  await connecting;
  return { socket, client };
}
