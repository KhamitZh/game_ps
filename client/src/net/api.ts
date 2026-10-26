import type { LevelId } from '../../../shared/src/levels';
import type { ErrorCode, Phase } from '../../../shared/src/protocol';
import { SERVER_URL } from '../config';

export interface GameInfo {
  exists: boolean;
  phase?: Phase;
  count?: number;
  full?: boolean;
}

export async function getGameInfo(pin: string): Promise<GameInfo> {
  const r = await fetch(`${SERVER_URL}/api/game/${encodeURIComponent(pin)}`);
  if (r.status === 404) return { exists: false };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export type CreateResult =
  | { ok: true; pin: string; hostToken: string; timeLimitMin: number; level: LevelId }
  | { ok: false; code: ErrorCode | 'NETWORK' };

export async function createGame(password: string, timeLimitMin: number, level: LevelId): Promise<CreateResult> {
  const r = await fetch(`${SERVER_URL}/api/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, timeLimitMin, level }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, pin: body.pin, hostToken: body.hostToken, timeLimitMin: body.timeLimitMin, level: body.level };
  return { ok: false, code: body.error ?? 'NETWORK' };
}
