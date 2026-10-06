import { describe, expect, it } from 'vitest';
import { TILE } from '../../shared/src/constants';
import { MAPS, ROOMS, roomAt, tileCenter, type RoomId } from '../../shared/src/map';
import { dirFromVec, stepMovement } from '../src/game/movement';

const none = new Set<RoomId>();
const f1 = MAPS.f1;

describe('stepMovement', () => {
  it('moves at SPEED px/s', () => {
    const p = stepMovement(f1, f1.spawn, { x: 1, y: 0 }, 100, none);
    expect(p.x - f1.spawn.x).toBeCloseTo(16);
    expect(p.y).toBe(f1.spawn.y);
  });

  it('normalises diagonal speed and caps dt', () => {
    const d = stepMovement(f1, f1.spawn, { x: 1, y: 1 }, 100, none);
    expect(Math.hypot(d.x - f1.spawn.x, d.y - f1.spawn.y)).toBeCloseTo(16);
    const capped = stepMovement(f1, f1.spawn, { x: 1, y: 0 }, 1000, none);
    expect(capped.x - f1.spawn.x).toBeCloseTo(16);
  });

  it('does nothing for a zero vector', () => {
    expect(stepMovement(f1, f1.spawn, { x: 0, y: 0 }, 100, none)).toEqual(f1.spawn);
  });

  it('slides along a wall', () => {
    const start = { x: 13.5 * TILE, y: 8 * TILE + 6 };
    const p = stepMovement(f1, start, { x: 1, y: -1 }, 100, none);
    expect(p.y).toBe(start.y);
    expect(p.x).toBeGreaterThan(start.x);
  });

  it('lines the player up with a door (corner assist)', () => {
    const door = ROOMS.f1r2.door;
    let p = { x: (door.x + 0.5) * TILE - 8, y: 8 * TILE + 6 };
    for (let i = 0; i < 4; i++) p = stepMovement(f1, p, { x: 0, y: -1 }, 100, none);
    expect(p.y).toBeLessThan(8 * TILE);
    expect(p.x).toBe((door.x + 0.5) * TILE);
  });

  it('does not enter an answered room', () => {
    const answered = new Set<RoomId>(['f1r2']);
    let p = tileCenter(ROOMS.f1r2.door.x, ROOMS.f1r2.door.y);
    for (let i = 0; i < 6; i++) p = stepMovement(f1, p, { x: 0, y: -1 }, 100, answered);
    expect(roomAt(f1, p.x, p.y)).toBeNull();
    expect(Math.floor(p.y / TILE)).toBe(ROOMS.f1r2.door.y);
  });
});

describe('dirFromVec', () => {
  it('picks the dominant axis and keeps the previous direction when idle', () => {
    expect(dirFromVec({ x: 1, y: 0.2 }, 'down')).toBe('right');
    expect(dirFromVec({ x: -0.1, y: -1 }, 'down')).toBe('up');
    expect(dirFromVec({ x: 0, y: 0 }, 'left')).toBe('left');
  });
});
