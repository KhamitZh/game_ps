import { describe, expect, it } from 'vitest';
import { ROOM_IDS } from '../../shared/src/map';
import { validateQuestions } from '../src/questions';
import bank from '../questions.json';

const good = () =>
  Object.fromEntries(ROOM_IDS.map((id) => [id, [{ q: 'Q?', options: ['a', 'b', 'c', 'd'], correct: 1 }]]));

describe('validateQuestions', () => {
  it('accepts a well-formed bank', () => {
    expect(validateQuestions(good()).f1r1[0].correct).toBe(1);
  });

  it('accepts the shipped questions.json', () => {
    expect(() => validateQuestions(bank)).not.toThrow();
  });

  it('reports every problem with its location', () => {
    const raw = good() as Record<string, unknown>;
    raw.f1r2 = [];
    raw.f1r3 = [{ q: '', options: ['a', 'b', 'c'], correct: 4 }];
    delete raw.f2r5;
    expect(() => validateQuestions(raw)).toThrowError(
      /f1r2: at least one question[\s\S]*f1r3\[0\]\.q[\s\S]*f1r3\[0\]\.options[\s\S]*f1r3\[0\]\.correct[\s\S]*f2r5/,
    );
  });

  it('rejects non-objects', () => {
    expect(() => validateQuestions(null)).toThrow();
  });
});
