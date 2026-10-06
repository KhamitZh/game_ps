import { describe, expect, it } from 'vitest';
import { errorAction } from '../src/errorRouting';

describe('errorAction', () => {
  it('keeps a player on the results screen when a late action is rejected', () => {
    expect(errorAction('results', 'WRONG_PHASE')).toBe('ignore');
    expect(errorAction('results', 'NOT_NEAR')).toBe('ignore');
  });

  it('reloads on a lost session during or after the game, goes home before it', () => {
    expect(errorAction('game', 'BAD_TOKEN')).toBe('reload');
    expect(errorAction('results', 'PIN_NOT_FOUND')).toBe('reload');
    expect(errorAction('connecting', 'BAD_TOKEN')).toBe('home');
  });

  it('routes join errors to the screen that can fix them', () => {
    expect(errorAction('connecting', 'NAME_TAKEN')).toBe('name');
    expect(errorAction('connecting', 'NAME_INVALID')).toBe('name');
    expect(errorAction('connecting', 'BAD_CHARACTER')).toBe('char');
    expect(errorAction('connecting', 'GAME_FULL')).toBe('home');
  });

  it('only toasts during the game, closing a pending question on interaction errors', () => {
    expect(errorAction('game', 'NOT_NEAR')).toBe('toastCloseQuestion');
    expect(errorAction('game', 'WRONG_PHASE')).toBe('toastCloseQuestion');
    expect(errorAction('game', 'FLOOR_LOCKED')).toBe('toastCloseQuestion');
    expect(errorAction('game', 'BUSY')).toBe('toast');
  });
});
