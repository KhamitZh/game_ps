import { describe, expect, it } from 'vitest';
import { TILE } from '../src/constants';
import {
  MAPS, ROOMS, ROOM_IDS, STAIRS_ARRIVAL, canStand, isBlockingTile, moveAllowed, nearPedestal,
  onStairs, roomAt, tileAt, tileCenter, type GameMap, type RoomDef, type RoomId,
} from '../src/map';

function reachable(map: GameMap, from: { x: number; y: number }): Set<string> {
  const start: [number, number] = [Math.floor(from.x / TILE), Math.floor(from.y / TILE)];
  const seen = new Set([start.join(',')]);
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && !isBlockingTile(tileAt(map, nx, ny))) {
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  }
  return seen;
}

/** The tile a player stands on to use the pedestal (between door and pedestal). */
function standTile(room: RoomDef) {
  const top = room.rect.y < 8;
  return { tx: room.pedestal.x, ty: room.pedestal.y + (top ? 1 : -1) };
}

describe('maps', () => {
  it('has five uniquely identified rooms per floor', () => {
    expect(MAPS.f1.rooms.map((r) => r.id)).toEqual(['f1r1', 'f1r2', 'f1r3', 'f1r4', 'f1r5']);
    expect(MAPS.f2.rooms.map((r) => r.id)).toEqual(['f2r1', 'f2r2', 'f2r3', 'f2r4', 'f2r5']);
    expect(Object.keys(ROOMS).sort()).toEqual([...ROOM_IDS].sort());
    expect(MAPS.lobby.rooms).toEqual([]);
  });

  it('has standable spawn points', () => {
    for (const m of Object.values(MAPS)) expect(canStand(m, m.spawn.x, m.spawn.y)).toBe(true);
    expect(canStand(MAPS.f2, STAIRS_ARRIVAL.x, STAIRS_ARRIVAL.y)).toBe(true);
    expect(onStairs(MAPS.f2, STAIRS_ARRIVAL.x, STAIRS_ARRIVAL.y)).toBe(false);
  });

  it('lets a player reach and use every pedestal from the spawn', () => {
    for (const floor of ['f1', 'f2'] as const) {
      const m = MAPS[floor];
      const seen = reachable(m, m.spawn);
      for (const room of m.rooms) {
        const { tx, ty } = standTile(room);
        expect(seen.has(`${tx},${ty}`), `${room.id} reachable`).toBe(true);
        const c = tileCenter(tx, ty);
        expect(nearPedestal(room, c.x, c.y)).toBe(true);
        expect(roomAt(m, c.x, c.y)?.id).toBe(room.id);
        expect(canStand(m, c.x, c.y)).toBe(true);
      }
    }
  });

  it('has reachable stairs on both floors', () => {
    for (const floor of ['f1', 'f2'] as const) {
      const m = MAPS[floor];
      const seen = reachable(m, m.spawn);
      const s = m.stairs!;
      expect(seen.has(`${s.x},${s.y + 1}`)).toBe(true);
      const c = tileCenter(s.x + 1, s.y + 1);
      expect(onStairs(m, c.x, c.y)).toBe(true);
    }
  });

  it('blocks walls and pedestals', () => {
    const m = MAPS.f1;
    const wall = tileCenter(9, 3);
    expect(canStand(m, wall.x, wall.y)).toBe(false);
    const ped = ROOMS.f1r1.pedestal;
    const pc = tileCenter(ped.x, ped.y);
    expect(canStand(m, pc.x, pc.y)).toBe(false);
    expect(canStand(m, tileCenter(0, 0).x, tileCenter(0, 0).y)).toBe(false);
  });

  it('forbids entering an answered room but allows leaving it', () => {
    const m = MAPS.f1;
    const door = tileCenter(ROOMS.f1r1.door.x, ROOMS.f1r1.door.y);
    const inside = tileCenter(ROOMS.f1r1.door.x, ROOMS.f1r1.door.y - 1);
    const answered = new Set<RoomId>(['f1r1']);
    expect(moveAllowed(m, door, inside, new Set())).toBe(true);
    expect(moveAllowed(m, door, inside, answered)).toBe(false);
    expect(moveAllowed(m, inside, door, answered)).toBe(true);
  });
});
