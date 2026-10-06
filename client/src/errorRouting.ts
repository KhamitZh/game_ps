import type { ErrorCode } from '../../shared/src/protocol';

export type Stage = 'home' | 'name' | 'char' | 'connecting' | 'game' | 'results';
export type ErrorAction = 'reload' | 'home' | 'name' | 'char' | 'ignore' | 'toast' | 'toastCloseQuestion';

const NAME_ERRORS: ErrorCode[] = ['NAME_TAKEN', 'NAME_INVALID'];
const INTERACT_ERRORS: ErrorCode[] = ['NOT_NEAR', 'ALREADY_ANSWERED', 'FLOOR_LOCKED', 'NO_QUESTION', 'WRONG_PHASE', 'BAD_REQUEST'];

/** Decides what the player app does with a server error, given where the player is. */
export function errorAction(stage: Stage, code: ErrorCode): ErrorAction {
  const inGame = stage === 'game' || stage === 'results';
  if (code === 'BAD_TOKEN' || code === 'PIN_NOT_FOUND') return inGame ? 'reload' : 'home';
  // After `ended`, in-flight actions come back rejected; the podium must stay.
  if (stage === 'results') return 'ignore';
  if (stage === 'game') return INTERACT_ERRORS.includes(code) ? 'toastCloseQuestion' : 'toast';
  if (NAME_ERRORS.includes(code)) return 'name';
  if (code === 'BAD_CHARACTER') return 'char';
  return 'home';
}
