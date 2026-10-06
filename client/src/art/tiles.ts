import { TILE } from '../../../shared/src/constants';
import { roomAtTile, tileAt, type GameMap, type Theme } from '../../../shared/src/map';

type R = (x: number, y: number, w: number, h: number, c: string) => void;

const FLOOR_COLORS: Record<Theme, [string, string]> = {
  library: ['#7b4f35', '#6c4430'],
  kitchen: ['#e4ddcf', '#c9c0ae'],
  living: ['#9c5b37', '#8a4f30'],
  bedroom: ['#6f7fb0', '#64739f'],
  bath: ['#a7dadf', '#8cc5cb'],
  lab: ['#c4c9d1', '#b2b8c1'],
  music: ['#6e3d66', '#5f3458'],
  games: ['#3b5788', '#334c78'],
  observatory: ['#272a4a', '#20223d'],
  studio: ['#dccaa3', '#cbb78e'],
};

const hash = (x: number, y: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;

export function drawMap(map: GameMap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.width * TILE;
  c.height = map.height * TILE;
  const g = c.getContext('2d')!;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) paintTile(g, map, x, y);
  return c;
}

function paintTile(g: CanvasRenderingContext2D, map: GameMap, tx: number, ty: number): void {
  const ch = tileAt(map, tx, ty);
  const ox = tx * TILE, oy = ty * TILE;
  const r: R = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(ox + x, oy + y, w, h);
  };
  const theme = roomAtTile(map, tx, ty)?.theme ?? 'library';
  switch (ch) {
    case '#': {
      const below = tileAt(map, tx, ty + 1);
      return wall(r, below !== '#' && below !== 'L');
    }
    case 'L':
      return screen(r, tileAt(map, tx, ty - 1) !== 'L', tileAt(map, tx, ty + 1) !== 'L', tileAt(map, tx - 1, ty) !== 'L', tileAt(map, tx + 1, ty) !== 'L');
    case '.':
    case 'D':
    case 'B':
      hall(r, tx, ty);
      if (ch === 'D') door(r);
      if (ch === 'B') bench(r);
      return;
    case 'S':
      return stairs(r);
    default:
      roomFloor(r, theme, tx, ty);
      if (ch === 'K') pedestal(r);
      if (ch === 'f') furniture(r, theme);
  }
}

function wall(r: R, face: boolean): void {
  if (!face) {
    r(0, 0, 32, 32, '#2a2438');
    r(0, 0, 32, 2, '#353047');
    return;
  }
  r(0, 0, 32, 32, '#8a6d5a');
  r(0, 0, 32, 4, '#a5876f');
  for (let row = 0; row < 4; row++) {
    const y = 4 + row * 7;
    r(0, y + 6, 32, 1, '#6e5545');
    for (let x = row % 2 ? 8 : 0; x < 32; x += 16) r(x, y, 1, 6, '#6e5545');
  }
  r(0, 30, 32, 2, '#4a3a30');
}

function hall(r: R, tx: number, ty: number): void {
  r(0, 0, 32, 32, '#b07a4f');
  for (let y = 0; y < 32; y += 8) r(0, y, 32, 1, '#8f6040');
  const k = hash(tx, ty);
  r((k % 4) * 8 + 2, (Math.floor(k / 4) % 4) * 8 + 3, 2, 2, '#946545');
  r(((k >> 3) % 2) * 16 + 10, 0, 1, 32, '#a06e47');
}

function roomFloor(r: R, theme: Theme, tx: number, ty: number): void {
  const [a, b] = FLOOR_COLORS[theme];
  r(0, 0, 32, 32, a);
  switch (theme) {
    case 'kitchen':
    case 'bath':
      if ((tx + ty) % 2) r(0, 0, 32, 32, b);
      r(0, 0, 32, 1, b);
      r(0, 0, 1, 32, b);
      break;
    case 'bedroom':
    case 'music':
    case 'games':
      for (let i = 0; i < 32; i += 4) r(i, (i * 3 + tx * 5 + ty * 7) % 30, 2, 2, b);
      break;
    case 'lab':
      r(0, 0, 32, 1, b);
      r(0, 0, 1, 32, b);
      r(15, 15, 2, 2, b);
      break;
    case 'observatory':
      if (hash(tx, ty) % 3 === 0) r((hash(ty, tx) % 28) + 2, (hash(tx + 7, ty) % 28) + 2, 2, 2, '#e8e4ff');
      break;
    default:
      for (let y = 0; y < 32; y += 8) r(0, y, 32, 1, b);
  }
}

function door(r: R): void {
  r(0, 0, 4, 32, '#5a3a22');
  r(28, 0, 4, 32, '#5a3a22');
  r(6, 10, 20, 12, '#7b2f2f');
  r(8, 12, 16, 8, '#94403c');
}

function bench(r: R): void {
  r(2, 8, 28, 14, '#7a5232');
  r(2, 8, 28, 3, '#9a6a42');
  r(4, 22, 3, 6, '#5a3a22');
  r(25, 22, 3, 6, '#5a3a22');
}

function stairs(r: R): void {
  r(0, 0, 32, 32, '#9b8a7a');
  for (let i = 0; i < 4; i++) {
    r(0, i * 8, 32, 4, '#b8a796');
    r(0, i * 8 + 7, 32, 1, '#6d5f52');
  }
}

function pedestal(r: R): void {
  r(8, 10, 16, 18, '#8d939c');
  r(6, 8, 20, 5, '#c4c9cf');
  r(6, 26, 20, 4, '#6b7178');
}

function screen(r: R, top: boolean, bottom: boolean, left: boolean, right: boolean): void {
  r(0, 0, 32, 32, '#0e1220');
  if (top) r(0, 0, 32, 3, '#3a4560');
  if (bottom) r(0, 29, 32, 3, '#3a4560');
  if (left) r(0, 0, 3, 32, '#3a4560');
  if (right) r(29, 0, 3, 32, '#3a4560');
}

function furniture(r: R, theme: Theme): void {
  switch (theme) {
    case 'library': {
      const books = ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad'];
      r(2, 2, 28, 28, '#5a3a22');
      for (let i = 0; i < 3; i++) {
        const y = 4 + i * 9;
        r(4, y + 7, 24, 2, '#3e2716');
        for (let x = 4; x < 28; x += 3) r(x, y, 2, 7, books[(x + i) % books.length]);
      }
      break;
    }
    case 'kitchen':
      r(2, 4, 28, 26, '#bfc4ca');
      r(2, 4, 28, 4, '#e3e6ea');
      r(6, 12, 8, 8, '#2b2b2b');
      r(18, 12, 8, 8, '#2b2b2b');
      r(8, 14, 4, 4, '#5a5a5a');
      r(20, 14, 4, 4, '#5a5a5a');
      r(4, 24, 24, 4, '#8a9096');
      break;
    case 'living':
      r(1, 8, 30, 20, '#2f7f86');
      r(1, 8, 30, 6, '#3a98a0');
      r(4, 14, 10, 8, '#43aab3');
      r(18, 14, 10, 8, '#43aab3');
      break;
    case 'bedroom':
      r(2, 2, 28, 28, '#e9e4da');
      r(4, 4, 24, 8, '#ffffff');
      r(2, 14, 28, 16, '#4a6fc1');
      r(2, 14, 28, 3, '#5b82d6');
      break;
    case 'bath':
      r(2, 6, 28, 22, '#f4f6f8');
      r(5, 9, 22, 15, '#7cc7e8');
      r(7, 11, 6, 3, '#bfe6f6');
      break;
    case 'lab':
      r(2, 10, 28, 18, '#7d8590');
      r(2, 10, 28, 3, '#a2abb6');
      r(6, 2, 5, 9, '#7be07b');
      r(15, 4, 5, 7, '#c77be0');
      r(23, 3, 4, 8, '#7bc5e0');
      break;
    case 'music':
      r(2, 6, 28, 20, '#1d1d1d');
      for (let x = 3; x < 29; x += 3) r(x, 16, 2, 9, '#f2f2f2');
      for (let x = 5; x < 27; x += 6) r(x, 16, 2, 5, '#1d1d1d');
      break;
    case 'games':
      r(6, 2, 20, 28, '#6a3fb5');
      r(9, 5, 14, 10, '#111111');
      r(10, 6, 12, 8, '#39d98a');
      r(10, 19, 4, 4, '#e5534b');
      r(18, 19, 4, 4, '#ffd54a');
      break;
    case 'observatory':
      r(14, 16, 4, 14, '#666666');
      r(8, 28, 16, 2, '#555555');
      r(4, 6, 22, 8, '#9aa3ad');
      r(24, 7, 6, 6, '#cfd6dd');
      break;
    case 'studio':
      r(15, 4, 2, 26, '#7a5232');
      r(6, 4, 20, 16, '#fffaf0');
      r(8, 6, 6, 6, '#e5534b');
      r(14, 10, 8, 6, '#3b7dd8');
      r(10, 14, 4, 4, '#ffd54a');
      break;
  }
}

function canvas(w: number, h: number, draw: (r: R, g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw((x, y, ww, hh, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, ww, hh);
  }, g);
  return c;
}

export function itemCanvases(): Record<'key' | 'mark-correct' | 'mark-wrong' | 'particle' | 'chain', HTMLCanvasElement> {
  return {
    key: canvas(16, 16, (r, g) => {
      r(1, 4, 7, 7, '#c99a1c');
      r(2, 5, 5, 5, '#ffd54a');
      g.clearRect(3, 6, 3, 3);
      r(8, 7, 7, 2, '#ffd54a');
      r(12, 9, 2, 3, '#ffd54a');
      r(9, 9, 2, 2, '#ffd54a');
      r(8, 9, 7, 1, '#c99a1c');
    }),
    'mark-correct': canvas(16, 16, (r) => {
      r(1, 1, 14, 14, '#2e8a55');
      for (const [x, y] of [[3, 8], [5, 10], [7, 8], [9, 6], [11, 4]]) r(x, y, 2, 2, '#ffffff');
    }),
    'mark-wrong': canvas(16, 16, (r) => {
      r(1, 1, 14, 14, '#a3332d');
      for (let i = 0; i < 5; i++) {
        r(3 + i * 2, 3 + i * 2, 2, 2, '#ffffff');
        r(11 - i * 2, 3 + i * 2, 2, 2, '#ffffff');
      }
    }),
    particle: canvas(4, 4, (r) => r(0, 0, 4, 4, '#ffffff')),
    chain: canvas(96, 96, (r) => {
      for (let i = 0; i < 12; i++) {
        r(i * 8, i * 8, 6, 4, '#9aa0a8');
        r(90 - i * 8, i * 8, 6, 4, '#9aa0a8');
      }
      r(36, 36, 24, 22, '#c99a1c');
      r(42, 28, 12, 10, '#9aa0a8');
      r(46, 44, 4, 8, '#3a2a00');
    }),
  };
}
