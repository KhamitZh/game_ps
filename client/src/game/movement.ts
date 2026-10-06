import { SPEED, TILE } from '../../../shared/src/constants';
import { moveAllowed, type GameMap, type Point, type RoomId } from '../../../shared/src/map';
import type { Dir } from '../../../shared/src/protocol';

const MAX_DT_MS = 100;
const DEADZONE = 0.05;

export function stepMovement(map: GameMap, pos: Point, vec: Point, dtMs: number, answered: ReadonlySet<RoomId>): Point {
  const len = Math.hypot(vec.x, vec.y);
  if (len < DEADZONE) return pos;
  const k = Math.min(len, 1) / len;
  const dist = (SPEED * Math.min(dtMs, MAX_DT_MS)) / 1000;
  let p = tryAxis(map, pos, vec.x * k * dist, 'x', answered);
  p = tryAxis(map, p, vec.y * k * dist, 'y', answered);
  return p;
}

function tryAxis(map: GameMap, p: Point, d: number, axis: 'x' | 'y', answered: ReadonlySet<RoomId>): Point {
  if (d === 0) return p;
  const next = axis === 'x' ? { x: p.x + d, y: p.y } : { x: p.x, y: p.y + d };
  if (moveAllowed(map, p, next, answered)) return next;
  // Corner assist: when blocked, slide toward the centre of the current tile on the other axis
  // so doors one tile wide are easy to walk through.
  const other = axis === 'x' ? 'y' : 'x';
  const centre = (Math.floor(p[other] / TILE) + 0.5) * TILE;
  const off = centre - p[other];
  if (Math.abs(off) < 0.5) return p;
  // Only assist when the path is open from the tile centre (a door), not against a solid wall.
  const aligned = other === 'x' ? { x: centre, y: p.y } : { x: p.x, y: centre };
  const beyond = axis === 'x' ? { x: aligned.x + d, y: aligned.y } : { x: aligned.x, y: aligned.y + d };
  if (!moveAllowed(map, aligned, beyond, answered)) return p;
  const step = Math.sign(off) * Math.min(Math.abs(off), Math.abs(d));
  const nudged = other === 'x' ? { x: p.x + step, y: p.y } : { x: p.x, y: p.y + step };
  return moveAllowed(map, p, nudged, answered) ? nudged : p;
}

export function dirFromVec(vec: Point, prev: Dir): Dir {
  if (Math.abs(vec.x) < DEADZONE && Math.abs(vec.y) < DEADZONE) return prev;
  if (Math.abs(vec.x) > Math.abs(vec.y)) return vec.x < 0 ? 'left' : 'right';
  return vec.y < 0 ? 'up' : 'down';
}
