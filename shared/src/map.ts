import { INTERACT_RADIUS, TILE } from './constants';

export type FloorId = 'lobby' | 'f1' | 'f2';
export const ROOM_IDS = [
  'f1r1', 'f1r2', 'f1r3', 'f1r4', 'f1r5', 'f2r1', 'f2r2', 'f2r3', 'f2r4', 'f2r5',
] as const;
export type RoomId = (typeof ROOM_IDS)[number];
export type Theme =
  | 'library' | 'kitchen' | 'living' | 'bedroom' | 'bath'
  | 'lab' | 'music' | 'games' | 'observatory' | 'studio';

export interface Point { x: number; y: number }
/** Rectangle in tile units. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface RoomDef {
  id: RoomId;
  floor: 'f1' | 'f2';
  theme: Theme;
  rect: Rect;
  door: Point;
  pedestal: Point;
}
export interface GameMap {
  id: FloorId;
  width: number;
  height: number;
  /** tiles[y][x]: # wall, . hall, , room floor, D door, K pedestal, f furniture, S stairs, B bench, L screen */
  tiles: string[][];
  /** Pixel position. */
  spawn: Point;
  rooms: RoomDef[];
  stairs: Rect | null;
}

const BLOCKING = new Set(['#', 'K', 'f', 'B', 'L']);
/** Half extents (px) of the player's feet box around its (x, y) feet point. */
export const HITBOX = { hw: 10, hh: 6 } as const;

export function isRoomId(v: unknown): v is RoomId {
  return typeof v === 'string' && (ROOM_IDS as readonly string[]).includes(v);
}
export function tileCenter(tx: number, ty: number): Point {
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
}
export function isBlockingTile(ch: string): boolean {
  return BLOCKING.has(ch);
}
export function tileAt(map: GameMap, tx: number, ty: number): string {
  return map.tiles[ty]?.[tx] ?? '#';
}

function grid(w: number, h: number, ch: string): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => ch));
}
function fill(g: string[][], r: Rect, ch: string): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g[y][x] = ch;
}
function contains(r: Rect, tx: number, ty: number): boolean {
  return tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
}

const FLOOR_W = 31;
const FLOOR_H = 19;
const ROOM_RECTS: Rect[] = [
  { x: 1, y: 1, w: 8, h: 6 },
  { x: 10, y: 1, w: 9, h: 6 },
  { x: 20, y: 1, w: 10, h: 6 },
  { x: 1, y: 12, w: 9, h: 6 },
  { x: 11, y: 12, w: 9, h: 6 },
];
const THEMES: Record<'f1' | 'f2', Theme[]> = {
  f1: ['library', 'kitchen', 'living', 'bedroom', 'bath'],
  f2: ['lab', 'music', 'games', 'observatory', 'studio'],
};
export const FLOOR_SPAWN = tileCenter(13, 9);
export const STAIRS_ARRIVAL = tileCenter(25, 9);

function buildFloor(floor: 'f1' | 'f2'): GameMap {
  const g = grid(FLOOR_W, FLOOR_H, '#');
  fill(g, { x: 1, y: 8, w: 29, h: 3 }, '.');
  const stairs: Rect = { x: 27, y: 8, w: 3, h: 3 };
  fill(g, stairs, 'S');
  const rooms = ROOM_RECTS.map((rect, i): RoomDef => {
    fill(g, rect, ',');
    const top = rect.y < 8;
    const cx = rect.x + Math.floor(rect.w / 2);
    const door = { x: cx, y: top ? rect.y + rect.h : rect.y - 1 };
    const pedestal = { x: cx, y: rect.y + Math.floor(rect.h / 2) };
    g[door.y][door.x] = 'D';
    g[pedestal.y][pedestal.x] = 'K';
    const fy = top ? rect.y : rect.y + rect.h - 1;
    for (const fx of [rect.x, rect.x + 1, rect.x + rect.w - 2, rect.x + rect.w - 1]) g[fy][fx] = 'f';
    return { id: `${floor}r${i + 1}` as RoomId, floor, theme: THEMES[floor][i], rect, door, pedestal };
  });
  return { id: floor, width: FLOOR_W, height: FLOOR_H, tiles: g, spawn: FLOOR_SPAWN, rooms, stairs };
}

function buildLobby(): GameMap {
  const W = 24, H = 15;
  const g = grid(W, H, '#');
  fill(g, { x: 1, y: 1, w: W - 2, h: H - 2 }, '.');
  fill(g, { x: 7, y: 1, w: 10, h: 3 }, 'L');
  for (const [x, y] of [[3, 5], [18, 5], [3, 10], [18, 10]]) fill(g, { x, y, w: 3, h: 1 }, 'B');
  return { id: 'lobby', width: W, height: H, tiles: g, spawn: tileCenter(12, 8), rooms: [], stairs: null };
}

export const MAPS: Record<FloorId, GameMap> = {
  lobby: buildLobby(),
  f1: buildFloor('f1'),
  f2: buildFloor('f2'),
};

export const ROOMS = Object.fromEntries(
  [...MAPS.f1.rooms, ...MAPS.f2.rooms].map((r) => [r.id, r]),
) as Record<RoomId, RoomDef>;

export function roomAtTile(map: GameMap, tx: number, ty: number): RoomDef | null {
  return map.rooms.find((r) => contains(r.rect, tx, ty)) ?? null;
}
export function roomAt(map: GameMap, x: number, y: number): RoomDef | null {
  return roomAtTile(map, Math.floor(x / TILE), Math.floor(y / TILE));
}

export function canStand(map: GameMap, x: number, y: number): boolean {
  const x0 = Math.floor((x - HITBOX.hw) / TILE);
  const x1 = Math.floor((x + HITBOX.hw - 1) / TILE);
  const y0 = Math.floor((y - HITBOX.hh) / TILE);
  const y1 = Math.floor((y + HITBOX.hh - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (isBlockingTile(tileAt(map, tx, ty))) return false;
  }
  return true;
}

/** Same rule on client and server: walls block, and an answered room can be left but not re-entered. */
export function moveAllowed(map: GameMap, from: Point, to: Point, answered: ReadonlySet<RoomId>): boolean {
  if (!canStand(map, to.x, to.y)) return false;
  const target = roomAt(map, to.x, to.y);
  if (target && answered.has(target.id) && roomAt(map, from.x, from.y)?.id !== target.id) return false;
  return true;
}

const PATH_STEP_PX = 8;

/**
 * Server-side check for a whole move segment: the feet point may not cross a blocking tile
 * or enter an answered room anywhere along the way, and the destination must pass moveAllowed.
 */
export function pathClear(map: GameMap, from: Point, to: Point, answered: ReadonlySet<RoomId>): boolean {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / PATH_STEP_PX);
  const startRoom = roomAt(map, from.x, from.y)?.id;
  for (let i = 1; i < steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    if (isBlockingTile(tileAt(map, Math.floor(x / TILE), Math.floor(y / TILE)))) return false;
    const room = roomAt(map, x, y);
    if (room && answered.has(room.id) && room.id !== startRoom) return false;
  }
  return moveAllowed(map, from, to, answered);
}

export function nearPedestal(room: RoomDef, x: number, y: number): boolean {
  const c = tileCenter(room.pedestal.x, room.pedestal.y);
  return Math.hypot(x - c.x, y - c.y) <= INTERACT_RADIUS;
}

export function onStairs(map: GameMap, x: number, y: number): boolean {
  return tileAt(map, Math.floor(x / TILE), Math.floor(y / TILE)) === 'S';
}
