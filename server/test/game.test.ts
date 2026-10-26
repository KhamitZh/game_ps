import { beforeEach, describe, expect, it } from 'vitest';
import { COUNTDOWN_MS } from '../../shared/src/constants';
import { LEVEL_IDS } from '../../shared/src/levels';
import { MAPS, ROOMS, ROOM_IDS, STAIRS_ARRIVAL, tileCenter, type RoomId } from '../../shared/src/map';
import { Game, type GameDeps } from '../src/game';
import type { QuestionBank } from '../src/questions';

/** Exactly one question per room, so a full run must use every question once. */
const POOL = ROOM_IDS.map((_, i) => ({ q: `q${i}`, options: [`o${i}a`, `o${i}b`, `o${i}c`, `o${i}d`], correct: i % 4 }));
const BANK = Object.fromEntries(
  LEVEL_IDS.map((id) => [id, id === 'python' ? POOL.map((x) => ({ ...x, q: `py-${x.q}` })) : POOL]),
) as QuestionBank;

let clock: number;
let seq: number;
let rngValues: number[];
const deps = (): GameDeps => ({
  now: () => clock,
  rng: () => (rngValues.length ? rngValues.shift()! : 0.5),
  newId: () => `id${++seq}`,
});
const newGame = (limitMin = 10) => new Game('123456', 'host-token', limitMin, 'numsys', BANK, deps());

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
  return a.order.indexOf(POOL[a.qIndex].correct);
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

  it('draws questions from the level the game was created with', () => {
    const g = new Game('123456', 'host-token', 10, 'python', BANK, deps());
    const p = join(g, 'A');
    startPlaying(g);
    standAt(g, p.id, 'f1r1');
    const r = g.interact(p.id, 'f1r1');
    if (!r.ok) throw new Error(r.code);
    expect(r.question.q).toMatch(/^py-/);
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
});
