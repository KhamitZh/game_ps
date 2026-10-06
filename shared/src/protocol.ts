import { LANGS, type Lang } from './constants';
import { isRoomId, type FloorId, type RoomId } from './map';
import type { RankedPlayer } from './ranking';

export type Phase = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'ENDED';
export type PlayerStatus = 'lobby' | 'playing' | 'finished';
export type Dir = 'down' | 'up' | 'left' | 'right';
export type AnswerMark = 'correct' | 'wrong';

export const ERROR_CODES = [
  'PIN_NOT_FOUND', 'GAME_FULL', 'NAME_INVALID', 'NAME_TAKEN', 'BAD_CHARACTER', 'ALREADY_STARTED',
  'BAD_TOKEN', 'BAD_HOST_TOKEN', 'BAD_PASSWORD', 'WRONG_PHASE', 'NOT_NEAR', 'ALREADY_ANSWERED',
  'FLOOR_LOCKED', 'NO_QUESTION', 'NO_PLAYERS', 'BAD_REQUEST', 'BUSY',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface PublicPlayer {
  id: string;
  name: string;
  character: number;
  keys: number;
  rooms: number;
  status: PlayerStatus;
  floor: FloorId;
  online: boolean;
  lastKeyAt: number | null;
}

export interface YouState {
  id: string;
  name: string;
  character: number;
  keys: number;
  rooms: number;
  answered: Partial<Record<RoomId, AnswerMark>>;
  floor2Unlocked: boolean;
  status: PlayerStatus;
  floor: FloorId;
  x: number;
  y: number;
}

export interface PhaseInfo {
  phase: Phase;
  countdownEndsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  /** Server clock at send time — clients derive an offset from it. */
  serverNow: number;
}

export interface PosEntry { id: string; x: number; y: number; dir: Dir; moving: boolean; floor: FloorId }
export interface QuestionView { roomId: RoomId; q: string; options: string[] }

export type ClientMsg =
  | { t: 'join'; name: string; character: number; lang: Lang }
  | { t: 'resume'; token: string }
  | { t: 'host'; hostToken: string }
  | { t: 'move'; x: number; y: number; dir: Dir; moving: boolean }
  | { t: 'interact'; roomId: RoomId }
  | { t: 'answer'; roomId: RoomId; optionIndex: number }
  | { t: 'stairs' }
  | { t: 'spectate'; targetId: string | null }
  | { t: 'start' }
  | { t: 'stop' };

export type ServerMsg =
  | { t: 'welcome'; token: string; you: YouState; phase: PhaseInfo; roster: PublicPlayer[] }
  | { t: 'hostWelcome'; pin: string; timeLimitMin: number; phase: PhaseInfo; roster: PublicPlayer[]; ranking: RankedPlayer[] | null }
  | { t: 'phase'; phase: PhaseInfo }
  | { t: 'roster'; players: PublicPlayer[] }
  | { t: 'you'; you: YouState }
  | { t: 'snapshot'; players: PosEntry[] }
  | { t: 'teleport'; floor: FloorId; x: number; y: number }
  | { t: 'question'; question: QuestionView }
  | { t: 'answerResult'; roomId: RoomId; correct: boolean }
  | { t: 'ended'; ranking: RankedPlayer[] }
  | { t: 'error'; code: ErrorCode };

const DIRS: readonly string[] = ['down', 'up', 'left', 'right'];
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > 2000) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'join':
      return isStr(m.name, 64) && Number.isInteger(m.character) && (LANGS as readonly unknown[]).includes(m.lang)
        ? { t: 'join', name: m.name, character: m.character as number, lang: m.lang as Lang }
        : null;
    case 'resume':
      return isStr(m.token, 64) ? { t: 'resume', token: m.token } : null;
    case 'host':
      return isStr(m.hostToken, 64) ? { t: 'host', hostToken: m.hostToken } : null;
    case 'move':
      return isNum(m.x) && isNum(m.y) && typeof m.dir === 'string' && DIRS.includes(m.dir) && typeof m.moving === 'boolean'
        ? { t: 'move', x: m.x, y: m.y, dir: m.dir as Dir, moving: m.moving }
        : null;
    case 'interact':
      return isRoomId(m.roomId) ? { t: 'interact', roomId: m.roomId } : null;
    case 'answer':
      return isRoomId(m.roomId) && Number.isInteger(m.optionIndex)
        ? { t: 'answer', roomId: m.roomId, optionIndex: m.optionIndex as number }
        : null;
    case 'stairs':
    case 'start':
    case 'stop':
      return { t: m.t };
    case 'spectate':
      return m.targetId === null || isStr(m.targetId, 64)
        ? { t: 'spectate', targetId: m.targetId as string | null }
        : null;
    default:
      return null;
  }
}
