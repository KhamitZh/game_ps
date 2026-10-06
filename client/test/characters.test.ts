import { describe, expect, it } from 'vitest';
import { CHARACTER_COUNT } from '../../shared/src/constants';
import { characterLook, charKey } from '../src/art/characters';

describe('characterLook', () => {
  it('gives 25 distinct, deterministic looks', () => {
    const looks = Array.from({ length: CHARACTER_COUNT }, (_, i) => JSON.stringify(characterLook(i)));
    expect(new Set(looks).size).toBe(CHARACTER_COUNT);
    expect(JSON.stringify(characterLook(7))).toBe(looks[7]);
  });

  it('uses hex colours and known accessories', () => {
    for (let i = 0; i < CHARACTER_COUNT; i++) {
      const l = characterLook(i);
      for (const c of [l.skin, l.hair, l.shirt, l.pants]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(['none', 'takiya', 'borik', 'glasses', 'scarf', 'cap']).toContain(l.accessory);
      expect(l.hairStyle).toBeGreaterThanOrEqual(0);
      expect(l.hairStyle).toBeLessThanOrEqual(4);
    }
  });

  it('names textures predictably', () => {
    expect(charKey(3)).toBe('char3');
  });
});
