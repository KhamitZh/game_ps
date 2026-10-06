import { describe, expect, it } from 'vitest';
import { Interp } from '../src/game/interp';

describe('Interp', () => {
  it('returns null when empty', () => {
    expect(new Interp().sample(10)).toBeNull();
  });

  it('interpolates between samples and clamps at both ends', () => {
    const i = new Interp();
    i.push(0, 0, 0);
    i.push(100, 10, 20);
    expect(i.sample(50)).toEqual({ x: 5, y: 10 });
    expect(i.sample(-5)).toEqual({ x: 0, y: 0 });
    expect(i.sample(500)).toEqual({ x: 10, y: 20 });
    expect(i.last()).toEqual({ x: 10, y: 20 });
  });

  it('can be reset after a teleport', () => {
    const i = new Interp();
    i.push(0, 0, 0);
    i.reset();
    i.push(10, 300, 300);
    expect(i.sample(5)).toEqual({ x: 300, y: 300 });
  });
});
