import { describe, expect, it } from 'vitest';
import { allowOrigin } from '../src/cors';

describe('allowOrigin', () => {
  it('allows everyone by default or with "*"', () => {
    expect(allowOrigin(undefined, 'https://a.app')).toBe('*');
    expect(allowOrigin('*', null)).toBe('*');
  });

  it('echoes an origin from the list and falls back to the first entry', () => {
    const list = 'https://key-house.vercel.app, https://kh.example.kz/';
    expect(allowOrigin(list, 'https://kh.example.kz')).toBe('https://kh.example.kz');
    expect(allowOrigin(list, 'https://evil.example')).toBe('https://key-house.vercel.app');
    expect(allowOrigin(list, null)).toBe('https://key-house.vercel.app');
  });
});
