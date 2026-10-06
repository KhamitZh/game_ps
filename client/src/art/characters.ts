import type { Dir } from '../../../shared/src/protocol';

export const CHAR_W = 16;
export const CHAR_H = 24;
/** Row order inside a character sheet. */
export const DIRS: Dir[] = ['down', 'left', 'right', 'up'];

export type Accessory = 'none' | 'takiya' | 'borik' | 'glasses' | 'scarf' | 'cap';
export interface CharacterLook {
  skin: string;
  hair: string;
  hairStyle: number;
  shirt: string;
  pants: string;
  accessory: Accessory;
}

const SKINS = ['#f5d0b0', '#e8b48f', '#c98e64', '#a56a43', '#7a4a2c'];
const HAIRS = ['#2b1d14', '#5a3a22', '#a0632e', '#d9b35f', '#1a1a1a'];
const SHIRTS = ['#d94f4f', '#3b7dd8', '#3fa96b', '#e0a526', '#8a55c9', '#e06aa8', '#2fb3b3', '#f07f3c'];
const PANTS = ['#2f3a56', '#4a3b2f', '#3d4a3a', '#555b66'];
const ACCESSORIES: Accessory[] = ['none', 'takiya', 'borik', 'glasses', 'scarf', 'cap'];

export function characterLook(i: number): CharacterLook {
  return {
    skin: SKINS[i % 5],
    hairStyle: Math.floor(i / 5) % 5,
    hair: HAIRS[(i * 2 + 1) % 5],
    shirt: SHIRTS[(i * 3) % SHIRTS.length],
    pants: PANTS[(i + Math.floor(i / 5)) % PANTS.length],
    accessory: ACCESSORIES[(i * 7 + 3) % ACCESSORIES.length],
  };
}

export function charKey(i: number): string {
  return `char${i}`;
}

type Px = (x: number, y: number, w: number, h: number, c: string) => void;

function shade(hex: string, k = 0.75): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round((n >> 16) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
}

function drawHair(px: Px, look: CharacterLook, dir: Dir): void {
  if (look.accessory === 'scarf') return; // the орамал covers the hair
  const h = look.hair;
  if (dir === 'up') {
    px(4, 2, 8, 8, h);
    if (look.hairStyle === 1 || look.hairStyle === 4) px(4, 10, 8, 2, h);
    if (look.hairStyle === 3) px(6, 0, 4, 2, h);
    return;
  }
  const side = dir !== 'down';
  switch (look.hairStyle) {
    case 0: // short
      px(4, 2, 8, 3, h);
      if (side) px(8, 5, 4, 3, h);
      else { px(4, 5, 1, 2, h); px(11, 5, 1, 2, h); }
      break;
    case 1: // long
      px(4, 2, 8, 3, h);
      if (side) px(8, 5, 4, 7, h);
      else { px(3, 4, 1, 8, h); px(12, 4, 1, 8, h); }
      break;
    case 2: // spiky
      px(4, 2, 8, 2, h);
      px(5, 1, 1, 1, h);
      px(7, 0, 2, 2, h);
      px(10, 1, 1, 1, h);
      if (side) px(9, 4, 3, 3, h);
      break;
    case 3: // bun
      px(4, 2, 8, 3, h);
      px(6, 0, 4, 2, h);
      if (side) px(9, 5, 3, 3, h);
      break;
    default: // bob
      px(3, 2, 10, 3, h);
      if (side) px(8, 5, 5, 5, h);
      else { px(3, 5, 2, 5, h); px(11, 5, 2, 5, h); }
  }
}

function drawAccessory(px: Px, look: CharacterLook, dir: Dir): void {
  switch (look.accessory) {
    case 'takiya':
      px(4, 1, 8, 2, '#7a1f2b');
      px(5, 1, 1, 1, '#e8c547');
      px(8, 1, 1, 1, '#e8c547');
      px(10, 1, 1, 1, '#e8c547');
      break;
    case 'borik':
      px(3, 1, 10, 3, '#6b4a2b');
      px(5, 0, 6, 1, '#b8322e');
      break;
    case 'glasses':
      if (dir === 'down') { px(5, 7, 3, 1, '#111111'); px(8, 7, 3, 1, '#111111'); }
      else if (dir !== 'up') px(4, 7, 3, 1, '#111111');
      break;
    case 'scarf': {
      const c = '#f0eadc', d = '#c9493f';
      px(3, 2, 10, 3, c);
      px(5, 3, 1, 1, d);
      px(8, 3, 1, 1, d);
      px(11, 3, 1, 1, d);
      if (dir === 'up') px(3, 5, 10, 7, c);
      else if (dir === 'down') { px(3, 5, 1, 6, c); px(12, 5, 1, 6, c); }
      else px(8, 5, 5, 6, c);
      break;
    }
    case 'cap':
      px(4, 1, 8, 3, '#2255aa');
      if (dir === 'down') px(4, 4, 8, 1, '#173d7a');
      else if (dir !== 'up') px(1, 3, 4, 1, '#173d7a');
      break;
    default:
      break;
  }
}

/** Draws one 16×24 frame. frame 0 = standing, 1 = left foot forward, 2 = right foot forward. */
export function drawCharacter(g: CanvasRenderingContext2D, look: CharacterLook, dir: Dir, frame: number, ox: number, oy: number): void {
  const mirror = dir === 'right';
  const side = dir === 'left' || dir === 'right';
  const px: Px = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(ox + (mirror ? CHAR_W - x - w : x), oy + y, w, h);
  };
  const shoe = '#2a2a2a';
  const lUp = frame === 1 ? 1 : 0;
  const rUp = frame === 2 ? 1 : 0;

  px(3, 22, 10, 2, 'rgba(0,0,0,0.28)');
  if (side) {
    px(5, 17, 3, 4 - rUp, shade(look.pants));
    px(5, 21 - rUp, 3, 1, shoe);
    px(8, 17, 3, 4 - lUp, look.pants);
    px(8, 21 - lUp, 3, 1, shoe);
  } else {
    px(5, 17, 2, 4 - lUp, look.pants);
    px(5, 21 - lUp, 2, 1, shoe);
    px(9, 17, 2, 4 - rUp, look.pants);
    px(9, 21 - rUp, 2, 1, shoe);
  }
  px(4, 11, 8, 6, look.shirt);
  px(4, 16, 8, 1, look.pants);
  if (side) {
    const swing = frame === 1 ? -1 : frame === 2 ? 1 : 0;
    px(7 + swing, 12, 2, 4, shade(look.shirt));
    px(7 + swing, 16, 2, 1, look.skin);
  } else {
    px(3, 12, 1, 4, look.shirt);
    px(12, 12, 1, 4, look.shirt);
    px(3, 16, 1, 1, look.skin);
    px(12, 16, 1, 1, look.skin);
  }
  px(4, 3, 8, 8, look.skin);
  if (dir === 'down') {
    px(6, 7, 1, 2, '#1d1d1d');
    px(9, 7, 1, 2, '#1d1d1d');
    px(7, 9, 2, 1, '#c0605a');
  } else if (side) {
    px(5, 7, 1, 2, '#1d1d1d');
  }
  drawHair(px, look, dir);
  drawAccessory(px, look, dir);
}

export function buildCharacterSheet(look: CharacterLook): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CHAR_W * 3;
  c.height = CHAR_H * DIRS.length;
  const g = c.getContext('2d')!;
  DIRS.forEach((dir, row) => {
    for (let f = 0; f < 3; f++) drawCharacter(g, look, dir, f, f * CHAR_W, row * CHAR_H);
  });
  return c;
}

export function characterPreview(i: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CHAR_W;
  c.height = CHAR_H;
  c.className = 'pix';
  drawCharacter(c.getContext('2d')!, characterLook(i), 'down', 0, 0, 0);
  return c;
}
