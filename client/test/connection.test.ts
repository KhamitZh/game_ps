import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, type ConnStatus, type WebSocketLike } from '../src/net/connection';

class FakeWS implements WebSocketLike {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeWS.all.push(this);
  }
  send(s: string) {
    this.sent.push(s);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  serverOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverDrop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

let statuses: ConnStatus[];
let messages: unknown[];
const make = () =>
  new Connection({
    url: 'ws://x/ws/123456',
    hello: () => ({ t: 'resume', token: 'tok' }),
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeWS,
  });

beforeEach(() => {
  vi.useFakeTimers();
  FakeWS.all = [];
  statuses = [];
  messages = [];
});
afterEach(() => vi.useRealTimers());

describe('Connection', () => {
  it('sends hello on open and parses messages', () => {
    const c = make();
    c.open();
    FakeWS.all[0].serverOpen();
    expect(JSON.parse(FakeWS.all[0].sent[0])).toEqual({ t: 'resume', token: 'tok' });
    FakeWS.all[0].onmessage?.({ data: '{"t":"phase"}' });
    FakeWS.all[0].onmessage?.({ data: 'garbage' });
    expect(messages).toEqual([{ t: 'phase' }]);
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('reconnects with exponential backoff and says hello again', () => {
    const c = make();
    c.open();
    FakeWS.all[0].serverOpen();
    FakeWS.all[0].serverDrop();
    expect(statuses.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(499);
    expect(FakeWS.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.all).toHaveLength(2);
    FakeWS.all[1].serverOpen();
    expect(FakeWS.all[1].sent).toHaveLength(1);
    expect(statuses.at(-1)).toBe('open');
  });

  it('gives up after five failed attempts', () => {
    const c = make();
    c.open();
    FakeWS.all[0].serverDrop();
    for (const delay of [500, 1000, 2000, 4000, 8000]) {
      vi.advanceTimersByTime(delay);
      FakeWS.all.at(-1)!.serverDrop();
    }
    expect(FakeWS.all).toHaveLength(6);
    expect(statuses.at(-1)).toBe('failed');
  });

  it('does not reconnect after close() or a server-final close code', () => {
    const a = make();
    a.open();
    FakeWS.all[0].serverOpen();
    a.close();
    vi.advanceTimersByTime(20_000);
    expect(FakeWS.all).toHaveLength(1);

    const b = make();
    b.open();
    FakeWS.all[1].serverOpen();
    FakeWS.all[1].serverDrop(4001);
    vi.advanceTimersByTime(20_000);
    expect(FakeWS.all).toHaveLength(2);
    expect(statuses.at(-1)).toBe('failed');
  });

  it('only sends while open', () => {
    const c = make();
    c.open();
    c.send({ t: 'stairs' });
    expect(FakeWS.all[0].sent).toEqual([]);
    FakeWS.all[0].serverOpen();
    c.send({ t: 'stairs' });
    expect(FakeWS.all[0].sent.at(-1)).toBe('{"t":"stairs"}');
  });
});
