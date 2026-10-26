import { DurableObject } from 'cloudflare:workers';
import questionsRaw from '../questions.json';
import { MAX_PLAYERS, TICK_MS } from '../../shared/src/constants';
import type { PoolSelection } from '../../shared/src/levels';
import type { FloorId } from '../../shared/src/map';
import { parseClientMsg, type ClientMsg, type ServerMsg } from '../../shared/src/protocol';
import type { Env } from './env';
import { Game, type GameData, type GameDeps } from './game';
import { validateQuestions } from './questions';

const QUESTIONS = validateQuestions(questionsRaw);
const CLEANUP_AFTER_MS = 3 * 60 * 60 * 1000;
const MAX_MSGS_PER_SEC = 30;

type Conn = { kind: 'pending' } | { kind: 'player'; id: string } | { kind: 'host' };
interface Session { conn: Conn; windowStart: number; count: number }

export class GameRoom extends DurableObject<Env> {
  private game: Game | null = null;
  private sessions = new Map<WebSocket, Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: GameDeps = {
    now: () => Date.now(),
    rng: Math.random,
    newId: () => crypto.randomUUID(),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const data = await ctx.storage.get<GameData>('game');
      if (data) this.game = Game.fromData(data, QUESTIONS, this.deps);
    });
  }

  // ---------- RPC from the Worker ----------

  async init(opts: { pin: string; timeLimitMin: number; selection: PoolSelection; hostToken: string }): Promise<boolean> {
    if (this.game && this.game.phase !== 'ENDED') return false;
    for (const ws of this.sessions.keys()) ws.close(1000, 'new game');
    this.sessions.clear();
    this.game = new Game(opts.pin, opts.hostToken, opts.timeLimitMin, opts.selection, QUESTIONS, this.deps);
    await this.persist();
    await this.ctx.storage.setAlarm(Date.now() + opts.timeLimitMin * 60_000 + CLEANUP_AFTER_MS);
    return true;
  }

  async info(): Promise<{ exists: false } | { exists: true; phase: Game['phase']; count: number; full: boolean }> {
    const g = this.game;
    if (!g) return { exists: false };
    return { exists: true, phase: g.phase, count: g.players.size, full: g.players.size >= MAX_PLAYERS };
  }

  async alarm(): Promise<void> {
    if (this.game && (this.game.phase === 'PLAYING' || this.game.phase === 'COUNTDOWN')) {
      await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
      return;
    }
    for (const ws of this.sessions.keys()) ws.close(1001, 'expired');
    this.sessions.clear();
    this.stopTimer();
    this.game = null;
    await this.ctx.storage.deleteAll();
  }

  // ---------- WebSocket ----------

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sessions.set(server, { conn: { kind: 'pending' }, windowStart: Date.now(), count: 0 });
    server.addEventListener('message', (ev) => this.onMessage(server, ev.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    this.ensureTimer();
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, data: unknown): void {
    const s = this.sessions.get(ws);
    if (!s || typeof data !== 'string') return;
    const now = Date.now();
    if (now - s.windowStart >= 1000) {
      s.windowStart = now;
      s.count = 0;
    }
    if (++s.count > MAX_MSGS_PER_SEC) return;
    const msg = parseClientMsg(data);
    if (!msg) return;
    const game = this.game;
    if (!game) {
      this.send(ws, { t: 'error', code: 'PIN_NOT_FOUND' });
      ws.close(4004, 'no game');
      return;
    }
    try {
      this.handle(ws, s, game, msg);
    } catch (err) {
      console.error('message handling failed', err);
    }
  }

  private handle(ws: WebSocket, s: Session, game: Game, msg: ClientMsg): void {
    if (s.conn.kind === 'pending') {
      if (msg.t === 'join') {
        const r = game.addPlayer(msg.name, msg.character, msg.lang);
        if (!r.ok) return this.send(ws, { t: 'error', code: r.code });
        this.bindPlayer(ws, s, r.player.id);
        this.broadcastRoster();
        void this.persist();
      } else if (msg.t === 'resume') {
        const p = game.resume(msg.token);
        if (!p) return this.send(ws, { t: 'error', code: 'BAD_TOKEN' });
        for (const [other, os] of this.sessions) {
          if (other !== ws && os.conn.kind === 'player' && os.conn.id === p.id) {
            this.sessions.delete(other);
            other.close(4001, 'replaced');
          }
        }
        const before = game.phase;
        game.setOnline(p.id, true);
        this.bindPlayer(ws, s, p.id);
        this.broadcastRoster();
        if (game.phase !== before) this.afterPhaseChange();
      } else if (msg.t === 'host') {
        if (msg.hostToken !== game.hostToken) return this.send(ws, { t: 'error', code: 'BAD_HOST_TOKEN' });
        s.conn = { kind: 'host' };
        this.send(ws, {
          t: 'hostWelcome',
          pin: game.pin,
          timeLimitMin: game.timeLimitMin,
          level: game.selection.level,
          subtopic: game.selection.subtopic,
          difficulty: game.selection.difficulty,
          phase: game.phaseInfo(),
          roster: game.roster(),
          ranking: game.phase === 'ENDED' ? game.ranking() : null,
        });
      }
      return;
    }

    if (s.conn.kind === 'host') {
      if (msg.t !== 'start' && msg.t !== 'stop') return;
      const r = msg.t === 'start' ? game.start() : game.stop();
      if (!r.ok) return this.send(ws, { t: 'error', code: r.code });
      this.afterPhaseChange();
      return;
    }

    const id = s.conn.id;
    switch (msg.t) {
      case 'move': {
        const r = game.move(id, msg.x, msg.y, msg.dir, msg.moving);
        if (r && !r.ok) this.send(ws, { t: 'teleport', ...r.fix });
        return;
      }
      case 'interact': {
        const r = game.interact(id, msg.roomId);
        this.send(ws, r.ok ? { t: 'question', question: r.question } : { t: 'error', code: r.code });
        if (r.ok) void this.persist();
        return;
      }
      case 'answer': {
        const before = game.phase;
        const r = game.answer(id, msg.roomId, msg.optionIndex);
        if (!r.ok) return this.send(ws, { t: 'error', code: r.code });
        const p = game.players.get(id)!;
        this.send(ws, { t: 'answerResult', roomId: msg.roomId, correct: r.correct });
        this.send(ws, { t: 'you', you: game.you(p) });
        if (r.finished) this.send(ws, { t: 'teleport', floor: p.floor, x: p.x, y: p.y });
        this.broadcastRoster();
        if (game.phase !== before) this.afterPhaseChange();
        else void this.persist();
        return;
      }
      case 'stairs': {
        const r = game.stairs(id);
        if (!r.ok) return this.send(ws, { t: 'error', code: r.code });
        this.send(ws, { t: 'teleport', floor: r.floor, x: r.x, y: r.y });
        this.broadcastRoster();
        return;
      }
      case 'spectate':
        game.spectate(id, msg.targetId);
        return;
    }
  }

  private bindPlayer(ws: WebSocket, s: Session, id: string): void {
    const game = this.game!;
    const p = game.players.get(id)!;
    s.conn = { kind: 'player', id };
    this.send(ws, { t: 'welcome', token: p.token, you: game.you(p), phase: game.phaseInfo(), roster: game.roster() });
    if (game.phase === 'ENDED') this.send(ws, { t: 'ended', ranking: game.ranking() });
  }

  private onClose(ws: WebSocket): void {
    const s = this.sessions.get(ws);
    if (!s) return;
    this.sessions.delete(ws);
    const game = this.game;
    if (game && s.conn.kind === 'player') {
      const id = s.conn.id;
      const stillConnected = [...this.sessions.values()].some((x) => x.conn.kind === 'player' && x.conn.id === id);
      if (!stillConnected) {
        const before = game.phase;
        game.setOnline(id, false);
        this.broadcastRoster();
        if (game.phase !== before) this.afterPhaseChange();
      }
    }
    if (this.sessions.size === 0) this.stopTimer();
  }

  // ---------- broadcasting ----------

  private afterPhaseChange(): void {
    const game = this.game!;
    this.broadcast({ t: 'phase', phase: game.phaseInfo() });
    for (const [ws, s] of this.sessions) {
      if (s.conn.kind !== 'player') continue;
      const p = game.players.get(s.conn.id);
      if (!p) continue;
      this.send(ws, { t: 'you', you: game.you(p) });
      if (game.phase === 'PLAYING') this.send(ws, { t: 'teleport', floor: p.floor, x: p.x, y: p.y });
    }
    if (game.phase === 'ENDED') this.broadcast({ t: 'ended', ranking: game.ranking() });
    this.broadcastRoster();
    void this.persist();
  }

  private broadcastRoster(): void {
    if (this.game) this.broadcast({ t: 'roster', players: this.game.roster() });
  }

  private broadcastSnapshots(game: Game): void {
    if (game.phase === 'ENDED') return;
    const cache = new Map<FloorId, string>();
    for (const [ws, s] of this.sessions) {
      if (s.conn.kind !== 'player') continue;
      const p = game.players.get(s.conn.id);
      if (!p) continue;
      const floor = game.viewFloor(p);
      let payload = cache.get(floor);
      if (!payload) {
        const msg: ServerMsg = { t: 'snapshot', players: game.snapshotFor(floor) };
        payload = JSON.stringify(msg);
        cache.set(floor, payload);
      }
      this.sendRaw(ws, payload);
    }
  }

  private broadcast(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const [ws, s] of this.sessions) if (s.conn.kind !== 'pending') this.sendRaw(ws, payload);
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, payload: string): void {
    try {
      ws.send(payload);
    } catch {
      // socket already closing; the close handler cleans up
    }
  }

  // ---------- timer & storage ----------

  private ensureTimer(): void {
    if (!this.timer) this.timer = setInterval(() => this.onTick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private onTick(): void {
    const game = this.game;
    if (!game || this.sessions.size === 0) {
      this.stopTimer();
      return;
    }
    if (game.tick()) this.afterPhaseChange();
    this.broadcastSnapshots(game);
  }

  private async persist(): Promise<void> {
    if (this.game) await this.ctx.storage.put('game', this.game.toData());
  }
}
