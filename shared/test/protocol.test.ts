import { describe, expect, it } from 'vitest';
import { parseClientMsg } from '../src/protocol';

const parse = (v: unknown) => parseClientMsg(JSON.stringify(v));

describe('parseClientMsg', () => {
  it('accepts a valid join', () => {
    expect(parse({ t: 'join', name: 'Аян', character: 3, lang: 'kk' }))
      .toEqual({ t: 'join', name: 'Аян', character: 3, lang: 'kk' });
  });

  it('rejects unknown languages and non-integer characters', () => {
    expect(parse({ t: 'join', name: 'A', character: 3, lang: 'de' })).toBeNull();
    expect(parse({ t: 'join', name: 'A', character: 1.5, lang: 'kk' })).toBeNull();
  });

  it('validates moves', () => {
    expect(parse({ t: 'move', x: 1, y: 2, dir: 'up', moving: true }))
      .toEqual({ t: 'move', x: 1, y: 2, dir: 'up', moving: true });
    expect(parse({ t: 'move', x: 1, y: 2, dir: 'north', moving: true })).toBeNull();
    expect(parse({ t: 'move', x: '1', y: 2, dir: 'up', moving: true })).toBeNull();
    expect(parse({ t: 'move', x: 1, y: 2, dir: 'up' })).toBeNull();
  });

  it('validates room ids and answers', () => {
    expect(parse({ t: 'interact', roomId: 'f1r3' })).toEqual({ t: 'interact', roomId: 'f1r3' });
    expect(parse({ t: 'interact', roomId: 'f3r1' })).toBeNull();
    expect(parse({ t: 'answer', roomId: 'f2r5', optionIndex: 2 }))
      .toEqual({ t: 'answer', roomId: 'f2r5', optionIndex: 2 });
    expect(parse({ t: 'answer', roomId: 'f2r5', optionIndex: 'x' })).toBeNull();
  });

  it('accepts bare commands and spectate targets', () => {
    expect(parse({ t: 'start' })).toEqual({ t: 'start' });
    expect(parse({ t: 'stop' })).toEqual({ t: 'stop' });
    expect(parse({ t: 'stairs' })).toEqual({ t: 'stairs' });
    expect(parse({ t: 'spectate', targetId: null })).toEqual({ t: 'spectate', targetId: null });
    expect(parse({ t: 'spectate', targetId: 'abc' })).toEqual({ t: 'spectate', targetId: 'abc' });
  });

  it('rejects garbage', () => {
    expect(parseClientMsg('not json')).toBeNull();
    expect(parse({ t: 'hack' })).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parseClientMsg('x'.repeat(5000))).toBeNull();
  });
});
