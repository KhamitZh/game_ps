import { beforeEach, describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, QUESTION_TIME_MS } from '../../shared/src/constants';
import { LEVEL_IDS, type PoolSelection } from '../../shared/src/levels';
import { MAPS, ROOMS, ROOM_IDS, STAIRS_ARRIVAL, tileCenter, type RoomId } from '../../shared/src/map';
import { ANSWER_GRACE_MS, Game, type GameDeps } from '../src/game';
import { selectPool, type QuestionBank } from '../src/questions';

/** Exactly one question per room, so a full run must use every question once. */
const POOL = ROOM_IDS.map((_, i) => ({ q: `q${i}`, options: [`o${i}a`, `o${i}b`, `o${i}c`, `o${i}d`], correct: i % 4 }));
const tag = (d: 'easy' | 'medium' | 'hard', prefix: string) =>
  POOL.map((x) => ({ ...x, q: `${prefix}-${x.q}`, difficulty: d }));
const PY = {
  basics: [...tag('easy', 'b-e'), ...tag('medium', 'b-m'), ...tag('hard', 'b-h')],
  conditions: [...tag('easy', 'c-e'), ...tag('medium', 'c-m'), ...tag('hard', 'c-h')],
  loops: [], strings: [], lists: [], functions: [],
};
const BANK = Object.fromEntries(LEVEL_IDS.map((id) => [id, id === 'python' ? PY : POOL])) as QuestionBank;

let clock: number;
let seq: number;
let rngValues: number[];
const deps = (): GameDeps => ({
  now: () => clock,
  rng: () => (rngValues.length ? rngValues.shift()! : 0.5),
  newId: () => `id${++seq}`,
});
const NUMSYS: PoolSelection = { level: 'numsys', subtopic: null, difficulty: null };
const newGame = (limitMin = 10, sel: PoolSelection = NUMSYS) => new Game('123456', 'host-token', limitMin, sel, BANK, deps());

function join(g: Game, name: string) {
  const r = g.addPlayer(name, 0, 'kk');
  if (!r.ok) throw new Error(r.code);
  return r.player;
}
function startPlaying(g: Game) {
  expect(g.start().ok).toBe(true);
  clock += COUNTDOWN_MS;
  g.tick();
  expect(g.phase).toBe('PLAYING');
}
function standAt(g: Game, id: string, roomId: RoomId) {
  const p = g.players.get(id)!;
  const room = ROOMS[roomId];
  const c = tileCenter(room.pedestal.x, room.pedestal.y + (room.rect.y < 8 ? 1 : -1));
  p.floor = room.floor;
  p.x = c.x;
  p.y = c.y;
}
function displayedCorrect(g: Game, id: string, roomId: RoomId) {
  const a = g.players.get(id)!.assigned[roomId]!;
  return a.order.indexOf(selectPool(BANK, g.selection)[a.qIndex].correct);
}
function solve(g: Game, id: string, roomId: RoomId, correct = true) {
  standAt(g, id, roomId);
  const q = g.interact(id, roomId);
  if (!q.ok) throw new Error(q.code);
  const idx = displayedCorrect(g, id, roomId);
  return g.answer(id, roomId, correct ? idx : (idx + 1) % 4);
}

beforeEach(() => {
  clock = 1_000_000;
  seq = 0;
  rngValues = [];
});

describe('lobby', () => {
  it('adds a player to the lobby', () => {
    const g = newGame();
    const p = join(g, 'Аян');
    expect(p).toMatchObject({ name: 'Аян', status: 'lobby', floor: 'lobby', keys: 0, rooms: 0, online: true });
    expect(p.token).toBeTruthy();
    expect(g.roster()).toHaveLength(1);
  });

  it('trims and validates names', () => {
    const g = newGame();
    const r = g.addPlayer('  Аян   Ж  ', 0, 'kk');
    expect(r.ok && r.player.name).toBe('Аян Ж');
    expect(g.addPlayer('   ', 0, 'kk')).toEqual({ ok: false, code: 'NAME_INVALID' });
    expect(g.addPlayer('x'.repeat(17), 0, 'kk')).toEqual({ ok: false, code: 'NAME_INVALID' });
    expect(g.addPlayer('x'.repeat(16), 0, 'kk').ok).toBe(true);
  });

  it('rejects case-insensitive duplicate Cyrillic names', () => {
    const g = newGame();
    join(g, 'Аян');
    expect(g.addPlayer('аЯН', 1, 'ru')).toEqual({ ok: false, code: 'NAME_TAKEN' });
  });

  it('rejects invalid character indices', () => {
    const g = newGame();
    for (const c of [25, -1, 1.5]) expect(g.addPlayer('A', c, 'kk')).toEqual({ ok: false, code: 'BAD_CHARACTER' });
  });

  it('caps the game at 30 players', () => {
    const g = newGame();
    for (let i = 0; i < 30; i++) join(g, `p${i}`);
    expect(g.addPlayer('late', 0, 'kk')).toEqual({ ok: false, code: 'GAME_FULL' });
  });

  it('resumes by token', () => {
    const g = newGame();
    const p = join(g, 'A');
    expect(g.resume(p.token)?.id).toBe(p.id);
    expect(g.resume('nope')).toBeUndefined();
  });

  it('rejects joining once the countdown started', () => {
    const g = newGame();
    join(g, 'A');
    g.start();
    expect(g.addPlayer('B', 0, 'kk')).toEqual({ ok: false, code: 'ALREADY_STARTED' });
  });
});

describe('phases', () => {
  it('needs at least one player to start', () => {
    expect(newGame().start()).toEqual({ ok: false, code: 'NO_PLAYERS' });
  });

  it('counts down, then moves everyone to floor 1', () => {
    const g = newGame();
    const p = join(g, 'A');
    g.start();
    expect(g.phase).toBe('COUNTDOWN');
    clock += COUNTDOWN_MS - 1;
    expect(g.tick()).toBe(false);
    clock += 1;
    expect(g.tick()).toBe(true);
    expect(g.phase).toBe('PLAYING');
    expect(p.status).toBe('playing');
    expect(p.floor).toBe('f1');
    expect(g.startedAt).toBe(g.countdownEndsAt);
    expect(g.endsAt).toBe(g.startedAt! + 10 * 60_000);
  });

  it('ends when the time runs out', () => {
    const g = newGame(1);
    join(g, 'A');
    startPlaying(g);
    clock += 60_000;
    expect(g.tick()).toBe(true);
    expect(g.phase).toBe('ENDED');
  });

  it('lets the host stop a running game but not a lobby', () => {
    const g = newGame();
    join(g, 'A');
    expect(g.stop()).toEqual({ ok: false, code: 'WRONG_PHASE' });
    startPlaying(g);
    expect(g.stop()).toEqual({ ok: true });
    expect(g.phase).toBe('ENDED');
  });
});

describe('movement', () => {
  it('accepts a normal step', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    const x0 = p.x;
    clock += 100;
    expect(g.move(p.id, x0 + 10, p.y, 'right', true)).toEqual({ ok: true });
    expect(p.x).toBe(x0 + 10);
    expect(p.moving).toBe(true);
  });

  it('rejects a step that is too long and returns the last good position', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    const r = g.move(p.id, p.x + 100, p.y, 'right', true);
    expect(r).toEqual({ ok: false, fix: { floor: 'f1', x: p.x, y: p.y } });
  });

  it('rejects walking into a wall', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    const c = tileCenter(1, 9);
    p.x = c.x;
    p.y = c.y;
    clock += 100;
    expect(g.move(p.id, 26, c.y, 'left', true)).toMatchObject({ ok: false });
  });

  it('rejects a long jump to a pedestal after standing still', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    clock += 10_000;
    const room = ROOMS.f1r2;
    const target = tileCenter(room.pedestal.x, room.pedestal.y + 1);
    expect(g.move(p.id, target.x, target.y, 'up', true)).toMatchObject({ ok: false });
    expect(g.interact(p.id, 'f1r2')).toEqual({ ok: false, code: 'NOT_NEAR' });
  });

  it('rejects a move that passes through a one-tile wall', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    const hall = tileCenter(3, 8);
    p.x = hall.x;
    p.y = hall.y;
    clock += 250;
    const inside = tileCenter(3, 6);
    expect(g.move(p.id, inside.x, inside.y, 'up', true)).toMatchObject({ ok: false });
  });

  it('ignores moves during the countdown', () => {
    const g = newGame();
    const p = join(g, 'A');
    g.start();
    expect(g.move(p.id, p.x + 1, p.y, 'right', true)).toBeNull();
  });

  it('rejects re-entering an answered room but allows walking inside it', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    solve(g, p.id, 'f1r1');
    const room = ROOMS.f1r1;
    clock += 1000;
    const inside = tileCenter(room.door.x, room.door.y - 1);
    expect(g.move(p.id, inside.x, inside.y, 'up', true)).toEqual({ ok: true });
    const door = tileCenter(room.door.x, room.door.y);
    p.x = door.x;
    p.y = door.y;
    clock += 1000;
    expect(g.move(p.id, inside.x, inside.y, 'up', true)).toMatchObject({ ok: false });
  });
});

describe('questions', () => {
  it('refuses interaction far from the pedestal', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    expect(g.interact(p.id, 'f1r1')).toEqual({ ok: false, code: 'NOT_NEAR' });
  });

  it('sends a shuffled question without the answer', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    standAt(g, p.id, 'f1r1');
    const r = g.interact(p.id, 'f1r1');
    if (!r.ok) throw new Error(r.code);
    expect(r.question.roomId).toBe('f1r1');
    expect(r.question.options).toHaveLength(4);
    expect(JSON.stringify(r)).not.toContain('correct');
    const a = p.assigned.f1r1!;
    expect([...r.question.options].sort()).toEqual([...POOL[a.qIndex].options].sort());
  });

  it('never gives the same player one question in two rooms', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    for (const id of ROOM_IDS) {
      rngValues = [0];
      solve(g, p.id, id);
    }
    const used = ROOM_IDS.map((id) => p.assigned[id]!.qIndex);
    expect(new Set(used).size).toBe(ROOM_IDS.length);
    expect(p.keys).toBe(ROOM_IDS.length);
  });

  it('draws questions only from the selected subtopic and difficulty', () => {
    const g = newGame(10, { level: 'python', subtopic: 'conditions', difficulty: 'hard' });
    const p = join(g, 'Aru');
    startPlaying(g);
    for (const roomId of ROOM_IDS) {
      standAt(g, p.id, roomId);
      const r = g.interact(p.id, roomId);
      if (!r.ok) throw new Error(r.code);
      expect(r.question.q.startsWith('c-h-'), r.question.q).toBe(true);
      expect(solve(g, p.id, roomId).ok).toBe(true);
    }
    expect(g.players.get(p.id)!.keys).toBe(ROOM_IDS.length);
  });

  it('draws from every subtopic for "all"', () => {
    const g = newGame(10, { level: 'python', subtopic: 'all', difficulty: 'easy' });
    const p = join(g, 'Aru');
    startPlaying(g);
    const draw = (roomId: RoomId, r: number) => {
      rngValues = [r];
      standAt(g, p.id, roomId);
      const q = g.interact(p.id, roomId);
      if (!q.ok) throw new Error(q.code);
      return q.question.q;
    };
    // The pool is basics/easy followed by conditions/easy: its first and last entries come from different subtopics.
    expect(draw(ROOM_IDS[0], 0)).toBe('b-e-q0');
    expect(draw(ROOM_IDS[1], 0.99)).toBe('c-e-q9');
  });

  it('keeps the same question and order on repeated interaction', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    standAt(g, p.id, 'f1r1');
    const first = g.interact(p.id, 'f1r1');
    rngValues = [0.99, 0.01, 0.99, 0.01, 0.99];
    expect(g.interact(p.id, 'f1r1')).toEqual(first);
  });

  it('gives a key, a room and lastKeyAt in whole seconds for a correct answer', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    clock += 12_700;
    expect(solve(g, p.id, 'f1r1', true)).toEqual({ ok: true, correct: true, finished: false });
    expect(p).toMatchObject({ keys: 1, rooms: 1, lastKeyAt: 12 });
    expect(p.answered.f1r1).toBe('correct');
  });

  it('counts only the room for a wrong answer and makes it final', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    expect(solve(g, p.id, 'f1r1', false)).toEqual({ ok: true, correct: false, finished: false });
    expect(p).toMatchObject({ keys: 0, rooms: 1, lastKeyAt: null });
    expect(g.interact(p.id, 'f1r1')).toEqual({ ok: false, code: 'ALREADY_ANSWERED' });
    expect(g.answer(p.id, 'f1r1', 0)).toEqual({ ok: false, code: 'ALREADY_ANSWERED' });
  });

  it('rejects an answer without a prior interaction', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    expect(g.answer(p.id, 'f1r2', 0)).toEqual({ ok: false, code: 'NO_QUESTION' });
  });

  it('rejects a late answer after the time ran out', () => {
    const g = newGame(1);
    const p = join(g, 'A');
    startPlaying(g);
    standAt(g, p.id, 'f1r1');
    g.interact(p.id, 'f1r1');
    clock += 60_000;
    g.tick();
    expect(g.answer(p.id, 'f1r1', 0)).toEqual({ ok: false, code: 'WRONG_PHASE' });
  });
});

describe('floors', () => {
  it('keeps floor 2 locked until all floor-1 rooms are answered', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    const s = tileCenter(28, 9);
    p.x = s.x;
    p.y = s.y;
    expect(g.stairs(p.id)).toEqual({ ok: false, code: 'FLOOR_LOCKED' });
    standAt(g, p.id, 'f2r1');
    expect(g.interact(p.id, 'f2r1')).toEqual({ ok: false, code: 'FLOOR_LOCKED' });
  });

  it('opens the stairs after five floor-1 answers, right or wrong', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    (['f1r1', 'f1r2', 'f1r3', 'f1r4', 'f1r5'] as RoomId[]).forEach((id, i) => solve(g, p.id, id, i % 2 === 0));
    expect(g.you(p).floor2Unlocked).toBe(true);
    const s = tileCenter(28, 9);
    p.floor = 'f1';
    p.x = s.x;
    p.y = s.y;
    expect(g.stairs(p.id)).toEqual({ ok: true, floor: 'f2', x: STAIRS_ARRIVAL.x, y: STAIRS_ARRIVAL.y });
    p.x = s.x;
    p.y = s.y;
    expect(g.stairs(p.id)).toMatchObject({ ok: true, floor: 'f1' });
  });

  it('requires standing on the stairs', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    expect(g.stairs(p.id)).toEqual({ ok: false, code: 'NOT_NEAR' });
  });
});

describe('finishing and ranking', () => {
  it('moves a finisher to the lobby and ends a solo game', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    let last;
    for (const id of ROOM_IDS) last = solve(g, p.id, id);
    expect(last).toEqual({ ok: true, correct: true, finished: true });
    expect(p.status).toBe('finished');
    expect(p.floor).toBe('lobby');
    expect(g.phase).toBe('ENDED');
  });

  it('keeps playing while another player is playing, and through a short disconnect', () => {
    const g = newGame();
    const a = join(g, 'A');
    const b = join(g, 'B');
    startPlaying(g);
    for (const id of ROOM_IDS) solve(g, a.id, id);
    expect(g.phase).toBe('PLAYING');
    g.setOnline(b.id, false);
    expect(g.phase).toBe('PLAYING');
    clock += 10_000;
    g.setOnline(b.id, true);
    clock += 60_000;
    expect(g.tick()).toBe(false);
    expect(g.phase).toBe('PLAYING');
  });

  it('ends once the last playing player has been offline for the grace period', () => {
    const g = newGame();
    const a = join(g, 'A');
    const b = join(g, 'B');
    startPlaying(g);
    for (const id of ROOM_IDS) solve(g, a.id, id);
    g.setOnline(b.id, false);
    clock += 29_999;
    expect(g.tick()).toBe(false);
    clock += 1;
    expect(g.tick()).toBe(true);
    expect(g.phase).toBe('ENDED');
  });

  it('ranks by keys then time', () => {
    const g = newGame();
    const a = join(g, 'A');
    const b = join(g, 'B');
    startPlaying(g);
    clock += 5000;
    for (const id of ROOM_IDS) solve(g, a.id, id);
    for (const id of ['f1r1', 'f1r2', 'f1r3'] as RoomId[]) solve(g, b.id, id);
    g.stop();
    expect(g.ranking().map((r) => [r.id, r.place, r.keys])).toEqual([[a.id, 1, 10], [b.id, 2, 3]]);
  });
});

describe('spectating and snapshots', () => {
  it('only includes online players on the requested floor', () => {
    const g = newGame();
    const a = join(g, 'A');
    const b = join(g, 'B');
    startPlaying(g);
    g.setOnline(b.id, false);
    expect(g.snapshotFor('f1').map((e) => e.id)).toEqual([a.id]);
    expect(g.snapshotFor('lobby')).toEqual([]);
  });

  it('gives the host every online player on every floor, each tagged with its floor', () => {
    const g = newGame();
    const a = join(g, 'A');
    const b = join(g, 'B');
    const c = join(g, 'C');
    startPlaying(g);
    for (const id of ROOM_IDS.slice(0, 5)) solve(g, b.id, id);
    standAt(g, b.id, 'f2r1');
    g.setOnline(c.id, false);
    const all = g.snapshotFor(null);
    expect(all.map((e) => [e.id, e.floor])).toEqual([[a.id, 'f1'], [b.id, 'f2']]);
  });

  it('shows a finished player the floor of the player they watch', () => {
    const g = newGame();
    const a = join(g, 'A');
    const b = join(g, 'B');
    startPlaying(g);
    for (const id of ROOM_IDS) solve(g, a.id, id);
    g.spectate(a.id, b.id);
    expect(g.viewFloor(a)).toBe('f1');
    g.spectate(a.id, null);
    expect(g.viewFloor(a)).toBe('lobby');
    g.spectate(b.id, a.id);
    expect(b.spectating).toBeNull();
  });
});

describe('persistence', () => {
  it('round-trips through toData/fromData keeping progress and assigned questions', () => {
    const g = newGame();
    const p = join(g, 'A');
    startPlaying(g);
    standAt(g, p.id, 'f1r1');
    const q = g.interact(p.id, 'f1r1');
    solve(g, p.id, 'f1r2');
    const g2 = Game.fromData(JSON.parse(JSON.stringify(g.toData())), BANK, deps());
    const p2 = g2.players.get(p.id)!;
    expect(g2.phase).toBe('PLAYING');
    expect(g2.level).toBe('numsys');
    expect(p2.online).toBe(false);
    expect(p2.answered.f1r2).toBeDefined();
    expect(p2.keys).toBe(1);
    g2.setOnline(p.id, true);
    standAt(g2, p.id, 'f1r1');
    expect(g2.interact(p.id, 'f1r1')).toEqual(q);
    expect(MAPS.f1.rooms).toHaveLength(5);
  });

  it('round-trips the selection through toData/fromData', () => {
    const sel: PoolSelection = { level: 'python', subtopic: 'conditions', difficulty: 'medium' };
    const g2 = Game.fromData(JSON.parse(JSON.stringify(newGame(10, sel).toData())), BANK, deps());
    expect(g2.selection).toEqual(sel);
    expect(g2.level).toBe('python');
  });

  it('keeps a game stored before subtopics existed playable', () => {
    const g = newGame(10, { level: 'python', subtopic: 'conditions', difficulty: 'hard' });
    const p = join(g, 'Aru');
    startPlaying(g);
    expect(solve(g, p.id, ROOM_IDS[0]).ok).toBe(true);
    const data = JSON.parse(JSON.stringify(g.toData()));
    delete data.subtopic;
    delete data.difficulty;
    data.players[0].assigned[ROOM_IDS[1]] = { qIndex: 9999, order: [0, 1, 2, 3] };
    const g2 = Game.fromData(data, BANK, deps());
    expect(g2.selection).toEqual({ level: 'python', subtopic: null, difficulty: null });
    expect(g2.answer(p.id, ROOM_IDS[1], 0)).toEqual({ ok: false, code: 'NO_QUESTION' });
  });

  it('refuses to open a room whose stored question no longer exists instead of throwing', () => {
    const g = newGame(10, { level: 'python', subtopic: 'conditions', difficulty: 'hard' });
    const p = join(g, 'Aru');
    startPlaying(g);
    const data = JSON.parse(JSON.stringify(g.toData()));
    data.players[0].assigned[ROOM_IDS[0]] = { qIndex: 9999, order: [0, 1, 2, 3] };
    const g2 = Game.fromData(data, BANK, deps());
    standAt(g2, p.id, ROOM_IDS[0]);
    expect(g2.interact(p.id, ROOM_IDS[0])).toEqual({ ok: false, code: 'NO_QUESTION' });
  });
});

describe('storage cleanup', () => {
  const KEEP_MS = 3 * 60 * 60 * 1000;

  it('a lobby that was never started is due for cleanup right away', () => {
    const g = newGame();
    join(g, 'Aru');
    expect(g.cleanupAt(KEEP_MS)).toBeLessThanOrEqual(clock);
  });

  it('a countdown waits until the countdown ends', () => {
    const g = newGame();
    join(g, 'Aru');
    g.start();
    expect(g.cleanupAt(KEEP_MS)).toBe(clock + COUNTDOWN_MS);
  });

  it('a running game waits until its time limit', () => {
    const g = newGame(10);
    join(g, 'Aru');
    startPlaying(g);
    expect(g.cleanupAt(KEEP_MS)).toBe(g.endsAt);
  });

  it('an ended game keeps its results for the keep period', () => {
    const g = newGame();
    join(g, 'Aru');
    startPlaying(g);
    g.stop();
    expect(g.cleanupAt(KEEP_MS)).toBe(g.endedAt! + KEEP_MS);
  });

  it('a game everyone left mid-play ends on tick once its time is up, then becomes due', () => {
    const g = newGame(10);
    const p = join(g, 'Aru');
    startPlaying(g);
    g.setOnline(p.id, false);
    clock = g.endsAt!;
    expect(g.tick()).toBe(true);
    expect(g.phase).toBe('ENDED');
    expect(g.cleanupAt(KEEP_MS)).toBe(clock + KEEP_MS);
    clock += KEEP_MS;
    expect(g.cleanupAt(KEEP_MS)).toBeLessThanOrEqual(clock);
  });
});

describe('question time limit', () => {
  function opened() {
    const g = newGame();
    const p = join(g, 'Aru');
    startPlaying(g);
    standAt(g, p.id, 'f1r1');
    const q = g.interact(p.id, 'f1r1');
    if (!q.ok) throw new Error(q.code);
    return { g, p, q: q.question };
  }

  it('gives every question a deadline from the first opening, and reopening keeps it', () => {
    const { g, p, q } = opened();
    expect(q.deadline).toBe(clock + QUESTION_TIME_MS);
    clock += 10_000;
    const again = g.interact(p.id, 'f1r1');
    expect(again.ok && again.question.deadline).toBe(q.deadline);
  });

  it('accepts the right answer within the limit plus network grace', () => {
    const { g, p } = opened();
    clock += QUESTION_TIME_MS + ANSWER_GRACE_MS;
    expect(g.answer(p.id, 'f1r1', displayedCorrect(g, p.id, 'f1r1'))).toMatchObject({ ok: true, correct: true });
  });

  it('counts a late answer as wrong even when it is the right option', () => {
    const { g, p } = opened();
    clock += QUESTION_TIME_MS + ANSWER_GRACE_MS + 1;
    expect(g.answer(p.id, 'f1r1', displayedCorrect(g, p.id, 'f1r1'))).toMatchObject({ ok: true, correct: false });
    expect(g.players.get(p.id)!.answered.f1r1).toBe('wrong');
  });

  it('treats optionIndex -1 as "time ran out": the room is used up without a key', () => {
    const { g, p } = opened();
    expect(g.answer(p.id, 'f1r1', -1)).toMatchObject({ ok: true, correct: false });
    expect(g.players.get(p.id)!.keys).toBe(0);
    expect(g.answer(p.id, 'f1r2', -2)).toEqual({ ok: false, code: 'BAD_REQUEST' });
  });
});

describe('question languages', () => {
  const RU = POOL.map((x) => ({ ...x, i18n: { ru: { q: `ru-${x.q}`, options: x.options.map((o) => `ru-${o}`) } } }));
  const TR_BANK = { ...BANK, numsys: RU } as QuestionBank;

  function view(lang?: 'kk' | 'ru' | 'en') {
    const g = new Game('123456', 'host-token', 10, NUMSYS, TR_BANK, deps());
    const p = join(g, 'Aru');
    startPlaying(g);
    standAt(g, p.id, 'f1r1');
    const r = g.interact(p.id, 'f1r1', lang);
    if (!r.ok) throw new Error(r.code);
    return { g, p, q: r.question };
  }

  it('shows the translation for the requested language, with options in the same shuffled order', () => {
    const { g, p, q } = view('ru');
    expect(q.q.startsWith('ru-q')).toBe(true);
    const a = g.players.get(p.id)!.assigned.f1r1!;
    expect(q.options).toEqual(a.order.map((i) => RU[a.qIndex].i18n.ru.options[i]));
  });

  it('falls back to Kazakh when there is no translation', () => {
    expect(view('en').q.q.startsWith('q')).toBe(true);
    expect(view('kk').q.q.startsWith('q')).toBe(true);
  });

  it('uses the language the player joined with when the request names none', () => {
    const g = new Game('123456', 'host-token', 10, NUMSYS, TR_BANK, deps());
    const r = g.addPlayer('Aru', 0, 'ru');
    if (!r.ok) throw new Error(r.code);
    startPlaying(g);
    standAt(g, r.player.id, 'f1r1');
    const q = g.interact(r.player.id, 'f1r1');
    expect(q.ok && q.question.q.startsWith('ru-')).toBe(true);
  });
});
