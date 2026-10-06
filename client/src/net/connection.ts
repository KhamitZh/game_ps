import type { ClientMsg, ServerMsg } from '../../../shared/src/protocol';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'failed';

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: never) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface ConnectionOptions {
  url: string;
  hello: () => ClientMsg | null;
  onMessage: (msg: ServerMsg) => void;
  onStatus: (s: ConnStatus) => void;
  WebSocketImpl?: WebSocketCtor;
  maxRetries?: number;
  baseDelayMs?: number;
}

const OPEN = 1;

export class Connection {
  private ws: WebSocketLike | null = null;
  private retries = 0;
  private closedByUser = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly o: ConnectionOptions) {}

  open(): void {
    this.closedByUser = false;
    this.retries = 0;
    this.connect();
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closedByUser = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private connect(): void {
    const Impl = this.o.WebSocketImpl ?? (WebSocket as unknown as WebSocketCtor);
    this.o.onStatus(this.retries === 0 ? 'connecting' : 'reconnecting');
    const ws = new Impl(this.o.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.o.onStatus('open');
      const hello = this.o.hello();
      if (hello) ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.o.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return;
      if (ev.code >= 4000) {
        this.o.onStatus('failed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const max = this.o.maxRetries ?? 5;
    if (this.retries >= max) {
      this.o.onStatus('failed');
      return;
    }
    const delay = (this.o.baseDelayMs ?? 500) * 2 ** this.retries;
    this.retries++;
    this.o.onStatus('reconnecting');
    this.timer = setTimeout(() => this.connect(), delay);
  }
}
