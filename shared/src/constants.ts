export const TILE = 32;
export const MAX_PLAYERS = 30;
export const CHARACTER_COUNT = 25;
export const NAME_MAX = 16;
export const PIN_LENGTH = 6;
/** Walk speed, px per second. */
export const SPEED = 160;
export const TICK_MS = 100;
export const COUNTDOWN_MS = 3000;
export const INTERACT_RADIUS = TILE * 1.5;
export const ROOMS_PER_FLOOR = 5;
export const TOTAL_ROOMS = 10;
export const DEFAULT_TIME_LIMIT_MIN = 10;
export const MIN_TIME_LIMIT_MIN = 1;
export const MAX_TIME_LIMIT_MIN = 60;
export const LANGS = ['kk', 'ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];
