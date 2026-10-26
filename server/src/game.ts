import {
  CHARACTER_COUNT, COUNTDOWN_MS, MAX_PLAYERS, NAME_MAX, ROOMS_PER_FLOOR, SPEED, TOTAL_ROOMS, type Lang,
} from '../../shared/src/constants';
import {
  FLOOR_SPAWN, MAPS, ROOMS, STAIRS_ARRIVAL, nearPedestal, onStairs, pathClear,
  type FloorId, type Point, type RoomId,
} from '../../shared/src/map';
import { DEFAULT_LEVEL, type Difficulty, type LevelId, type PoolSelection } from '../../shared/src/levels';
import { rank, type RankedPlayer } from '../../shared/src/ranking';
import type {
  AnswerMark, Dir, ErrorCode, Phase, PhaseInfo, PlayerStatus, PosEntry, PublicPlayer, QuestionView, YouState,
} from '../../shared/src/protocol';
import { selectPool, type Question, type QuestionBank } from './questions';

export interface Assigned {
  /** Index into the level's question pool. */
  qIndex: number;
  /** order[displayIndex] = original option index */
  order: number[];
}

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  character: number;
  lang: Lang;
  online: boolean;
  /** When the player last went offline; null while online. */
  offlineSince: number | null;
  status: PlayerStatus;
  floor: FloorId;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  lastMoveAt: number;
  keys: number;
  rooms: number;
  lastKeyAt: number | null;
  answered: Partial<Record<RoomId, AnswerMark>>;
  assigned: Partial<Record<RoomId, Assigned>>;
  spectating: string | null;
}

export interface GameData {
  pin: string;
  hostToken: string;
  timeLimitMin: number;
  level: LevelId;
  /** Missing in games stored before subtopics existed. */
  subtopic?: string | null;
  difficulty?: Difficulty | null;
  phase: Phase;
  countdownEndsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  players: PlayerState[];
}

export interface GameDeps {
  now(): number;
  rng(): number;
  newId(): string;
}

type Fail = { ok: false; code: ErrorCode };
const fail = (code: ErrorCode): Fail => ({ ok: false, code });

/** Server never measures a move over less than this, so bunched packets are not punished. */
const MIN_MOVE_DT_MS = 100;
/** Idle time does not bank movement budget: a standing player cannot teleport later. */
const MAX_MOVE_DT_MS = 250;
/** A playing player only counts as gone for the "everyone finished" rule after this long offline. */
export const OFFLINE_GRACE_MS = 30_000;
const MOVE_SLACK = 1.5;
const MOVE_SLACK_PX = 4;

export class Game {
  phase: Phase = 'LOBBY';
  countdownEndsAt: number | null = null;
  startedAt: number | null = null;
  endsAt: number | null = null;
  endedAt: number | null = null;
  readonly players = new Map<string, PlayerState>();
  private readonly pool: Question[];

  constructor(
    readonly pin: string,
    readonly hostToken: string,
    readonly timeLimitMin: number,
    readonly selection: PoolSelection,
    questions: QuestionBank,
    private readonly deps: GameDeps,
  ) {
    this.pool = selectPool(questions, selection);
  }

  get level(): LevelId {
    return this.selection.level;
  }

  static fromData(d: GameData, questions: QuestionBank, deps: GameDeps): Game {
    const selection: PoolSelection = { level: d.level ?? DEFAULT_LEVEL, subtopic: d.subtopic ?? null, difficulty: d.difficulty ?? null };
    const g = new Game(d.pin, d.hostToken, d.timeLimitMin, selection, questions, deps);
    g.phase = d.phase;
    g.countdownEndsAt = d.countdownEndsAt;
    g.startedAt = d.startedAt;
    g.endsAt = d.endsAt;
    g.endedAt = d.endedAt;
    for (const p of d.players) g.players.set(p.id, { ...p, online: false, offlineSince: deps.now(), moving: false });
    return g;
  }

  toData(): GameData {
    return {
      pin: this.pin,
      hostToken: this.hostToken,
      timeLimitMin: this.timeLimitMin,
      level: this.selection.level,
      subtopic: this.selection.subtopic,
      difficulty: this.selection.difficulty,
      phase: this.phase,
      countdownEndsAt: this.countdownEndsAt,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      endedAt: this.endedAt,
      players: [...this.players.values()].map((p) => structuredClone(p)),
    };
  }

  // ---------- lobby ----------

  addPlayer(rawName: string, character: number, lang: Lang): { ok: true; player: PlayerState } | Fail {
    if (this.phase !== 'LOBBY') return fail('ALREADY_STARTED');
    const name = rawName.trim().replace(/\s+/g, ' ');
    const len = [...name].length;
    if (len < 1 || len > NAME_MAX) return fail('NAME_INVALID');
    if (!Number.isInteger(character) || character < 0 || character >= CHARACTER_COUNT) return fail('BAD_CHARACTER');
    if (this.players.size >= MAX_PLAYERS) return fail('GAME_FULL');
    const key = name.toLocaleLowerCase();
    for (const p of this.players.values()) if (p.name.toLocaleLowerCase() === key) return fail('NAME_TAKEN');
    const pos = this.jitter(MAPS.lobby.spawn);
    const player: PlayerState = {
      id: this.deps.newId(),
      token: this.deps.newId(),
      name,
      character,
      lang,
      online: true,
      offlineSince: null,
      status: 'lobby',
      floor: 'lobby',
      x: pos.x,
      y: pos.y,
      dir: 'down',
      moving: false,
      lastMoveAt: this.deps.now(),
      keys: 0,
      rooms: 0,
      lastKeyAt: null,
      answered: {},
      assigned: {},
      spectating: null,
    };
    this.players.set(player.id, player);
    return { ok: true, player };
  }

  resume(token: string): PlayerState | undefined {
    for (const p of this.players.values()) if (p.token === token) return p;
    return undefined;
  }

  setOnline(id: string, online: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.online = online;
    p.offlineSince = online ? null : this.deps.now();
    if (!online) p.moving = false;
    p.lastMoveAt = this.deps.now();
    this.checkAllDone();
  }

  // ---------- phases ----------

  start(): { ok: true } | Fail {
    if (this.phase !== 'LOBBY') return fail('WRONG_PHASE');
    if (this.players.size === 0) return fail('NO_PLAYERS');
    this.phase = 'COUNTDOWN';
    this.countdownEndsAt = this.deps.now() + COUNTDOWN_MS;
    return { ok: true };
  }

  stop(): { ok: true } | Fail {
    if (this.phase !== 'PLAYING' && this.phase !== 'COUNTDOWN') return fail('WRONG_PHASE');
    this.end();
    return { ok: true };
  }

  /** Advances timers. Returns true when the phase changed. */
  tick(): boolean {
    const now = this.deps.now();
    if (this.phase === 'COUNTDOWN' && this.countdownEndsAt !== null && now >= this.countdownEndsAt) {
      this.beginPlaying();
      return true;
    }
    if (this.phase === 'PLAYING' && this.endsAt !== null && now >= this.endsAt) {
      this.end();
      return true;
    }
    if (this.phase === 'PLAYING') {
      this.checkAllDone();
      if ((this.phase as Phase) === 'ENDED') return true;
    }
    return false;
  }

  private beginPlaying(): void {
    this.phase = 'PLAYING';
    this.startedAt = this.countdownEndsAt;
    this.endsAt = this.startedAt! + this.timeLimitMin * 60_000;
    const now = this.deps.now();
    for (const p of this.players.values()) {
      const pos = this.jitter(FLOOR_SPAWN);
      Object.assign(p, { status: 'playing', floor: 'f1', x: pos.x, y: pos.y, moving: false, lastMoveAt: now });
    }
  }

  private end(): void {
    this.phase = 'ENDED';
    this.endedAt = this.deps.now();
    for (const p of this.players.values()) p.moving = false;
  }

  private checkAllDone(): void {
    if (this.phase !== 'PLAYING') return;
    const all = [...this.players.values()];
    const now = this.deps.now();
    const stillPlaying = all.filter(
      (p) => p.status === 'playing' && (p.online || p.offlineSince === null || now - p.offlineSince < OFFLINE_GRACE_MS),
    );
    if (stillPlaying.length === 0 && all.some((p) => p.status === 'finished')) this.end();
  }

  // ---------- actions ----------

  move(id: string, x: number, y: number, dir: Dir, moving: boolean):
    { ok: true } | { ok: false; fix: { floor: FloorId; x: number; y: number } } | null {
    const p = this.players.get(id);
    if (!p || this.phase === 'COUNTDOWN' || this.phase === 'ENDED') return null;
    const now = this.deps.now();
    const dt = Math.min(Math.max(now - p.lastMoveAt, MIN_MOVE_DT_MS), MAX_MOVE_DT_MS);
    const maxDist = (SPEED * dt * MOVE_SLACK) / 1000 + MOVE_SLACK_PX;
    const valid =
      Number.isFinite(x) && Number.isFinite(y) &&
      Math.hypot(x - p.x, y - p.y) <= maxDist &&
      pathClear(MAPS[p.floor], { x: p.x, y: p.y }, { x, y }, this.answeredSet(p));
    if (!valid) return { ok: false, fix: { floor: p.floor, x: p.x, y: p.y } };
    Object.assign(p, { x, y, dir, moving, lastMoveAt: now });
    return { ok: true };
  }

  stairs(id: string): { ok: true; floor: FloorId; x: number; y: number } | Fail {
    const p = this.players.get(id);
    if (!p || this.phase !== 'PLAYING' || p.status !== 'playing') return fail('WRONG_PHASE');
    if (!onStairs(MAPS[p.floor], p.x, p.y)) return fail('NOT_NEAR');
    if (p.floor === 'f1' && !this.floor2Unlocked(p)) return fail('FLOOR_LOCKED');
    p.floor = p.floor === 'f1' ? 'f2' : 'f1';
    p.x = STAIRS_ARRIVAL.x;
    p.y = STAIRS_ARRIVAL.y;
    p.moving = false;
    p.lastMoveAt = this.deps.now();
    return { ok: true, floor: p.floor, x: p.x, y: p.y };
  }

  interact(id: string, roomId: RoomId): { ok: true; question: QuestionView } | Fail {
    const p = this.players.get(id);
    if (!p || this.phase !== 'PLAYING' || p.status !== 'playing') return fail('WRONG_PHASE');
    const room = ROOMS[roomId];
    if (!room) return fail('BAD_REQUEST');
    if (p.answered[roomId]) return fail('ALREADY_ANSWERED');
    if (room.floor === 'f2' && !this.floor2Unlocked(p)) return fail('FLOOR_LOCKED');
    if (room.floor !== p.floor || !nearPedestal(room, p.x, p.y)) return fail('NOT_NEAR');
    const pool = this.pool;
    if (!pool?.length) return fail('NO_QUESTION');
    let a = p.assigned[roomId];
    if (!a) {
      // A question already pinned to another room is never drawn again for the same player.
      const used = new Set(Object.values(p.assigned).map((x) => x.qIndex));
      const free = pool.map((_, i) => i).filter((i) => !used.has(i));
      if (!free.length) return fail('NO_QUESTION');
      a = { qIndex: free[Math.floor(this.deps.rng() * free.length)], order: this.shuffle([0, 1, 2, 3]) };
      p.assigned[roomId] = a;
    }
    const q = pool[a.qIndex];
    return { ok: true, question: { roomId, q: q.q, options: a.order.map((i) => q.options[i]) } };
  }

  answer(id: string, roomId: RoomId, optionIndex: number): { ok: true; correct: boolean; finished: boolean } | Fail {
    const p = this.players.get(id);
    if (!p || this.phase !== 'PLAYING' || p.status !== 'playing') return fail('WRONG_PHASE');
    if (!ROOMS[roomId] || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) return fail('BAD_REQUEST');
    if (p.answered[roomId]) return fail('ALREADY_ANSWERED');
    const a = p.assigned[roomId];
    if (!a) return fail('NO_QUESTION');
    const q = this.pool[a.qIndex];
    if (!q) return fail('NO_QUESTION');
    const correct = a.order[optionIndex] === q.correct;
    p.answered[roomId] = correct ? 'correct' : 'wrong';
    p.rooms += 1;
    if (correct) {
      p.keys += 1;
      p.lastKeyAt = this.elapsedSec();
    }
    let finished = false;
    if (p.rooms >= TOTAL_ROOMS) {
      const pos = this.jitter(MAPS.lobby.spawn);
      Object.assign(p, { status: 'finished', floor: 'lobby', x: pos.x, y: pos.y, moving: false, spectating: null });
      p.lastMoveAt = this.deps.now();
      finished = true;
    }
    this.checkAllDone();
    return { ok: true, correct, finished };
  }

  spectate(id: string, targetId: string | null): void {
    const p = this.players.get(id);
    if (!p || p.status !== 'finished') return;
    if (targetId === null) {
      p.spectating = null;
      return;
    }
    const t = this.players.get(targetId);
    if (t && t.status === 'playing') p.spectating = targetId;
  }

  // ---------- views ----------

  floor2Unlocked(p: PlayerState): boolean {
    let n = 0;
    for (const id of Object.keys(p.answered)) if (id.startsWith('f1')) n++;
    return n >= ROOMS_PER_FLOOR;
  }

  phaseInfo(): PhaseInfo {
    return {
      phase: this.phase,
      countdownEndsAt: this.countdownEndsAt,
      startedAt: this.startedAt,
      endsAt: this.endsAt,
      serverNow: this.deps.now(),
    };
  }

  roster(): PublicPlayer[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      character: p.character,
      keys: p.keys,
      rooms: p.rooms,
      status: p.status,
      floor: p.floor,
      online: p.online,
      lastKeyAt: p.lastKeyAt,
    }));
  }

  you(p: PlayerState): YouState {
    return {
      id: p.id,
      name: p.name,
      character: p.character,
      keys: p.keys,
      rooms: p.rooms,
      answered: { ...p.answered },
      floor2Unlocked: this.floor2Unlocked(p),
      status: p.status,
      floor: p.floor,
      x: p.x,
      y: p.y,
    };
  }

  /** Which floor this player's screen shows (spectators see their target's floor). */
  viewFloor(p: PlayerState): FloorId {
    if (p.status === 'finished' && p.spectating) {
      const t = this.players.get(p.spectating);
      if (t && t.status === 'playing') return t.floor;
    }
    return p.floor;
  }

  snapshotFor(floor: FloorId): PosEntry[] {
    const out: PosEntry[] = [];
    for (const p of this.players.values()) {
      if (!p.online || p.floor !== floor) continue;
      out.push({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), dir: p.dir, moving: p.moving, floor: p.floor });
    }
    return out;
  }

  ranking(): RankedPlayer[] {
    return rank(
      [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, character: p.character, keys: p.keys, lastKeyAt: p.lastKeyAt,
      })),
    );
  }

  // ---------- helpers ----------

  private elapsedSec(): number {
    return Math.floor((this.deps.now() - (this.startedAt ?? this.deps.now())) / 1000);
  }

  private answeredSet(p: PlayerState): Set<RoomId> {
    return new Set(Object.keys(p.answered) as RoomId[]);
  }

  private jitter(base: Point): Point {
    return { x: base.x + (this.deps.rng() - 0.5) * 64, y: base.y + (this.deps.rng() - 0.5) * 40 };
  }

  private shuffle<T>(items: T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.deps.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
