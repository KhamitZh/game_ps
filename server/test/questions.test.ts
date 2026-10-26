import { describe, expect, it } from 'vitest';
import { LEVEL_IDS, MAX_LEVEL_QUESTIONS, MIN_LEVEL_QUESTIONS } from '../../shared/src/levels';
import { validateQuestions } from '../src/questions';
import bank from '../questions.json';

const pool = (n: number, tag = 'Q') =>
  Array.from({ length: n }, (_, i) => ({ q: `${tag}${i}?`, options: ['a', 'b', 'c', 'd'], correct: i % 4 }));
const good = () => Object.fromEntries(LEVEL_IDS.map((id) => [id, pool(MIN_LEVEL_QUESTIONS, id)]));

describe('validateQuestions', () => {
  it('accepts a well-formed bank', () => {
    expect(validateQuestions(good()).numsys[1].correct).toBe(1);
  });

  it('accepts the shipped questions.json', () => {
    expect(() => validateQuestions(bank)).not.toThrow();
  });

  it(`keeps every shipped level within ${MIN_LEVEL_QUESTIONS}..${MAX_LEVEL_QUESTIONS} questions`, () => {
    for (const id of LEVEL_IDS) {
      const n = (bank as Record<string, unknown[]>)[id].length;
      expect(n, id).toBeGreaterThanOrEqual(MIN_LEVEL_QUESTIONS);
      expect(n, id).toBeLessThanOrEqual(MAX_LEVEL_QUESTIONS);
    }
  });

  it('reports every problem with its location', () => {
    const raw = good() as Record<string, unknown>;
    raw.database = pool(MIN_LEVEL_QUESTIONS - 1);
    raw.excel = [{ q: '', options: ['a', 'b', 'c'], correct: 4 }, ...pool(MIN_LEVEL_QUESTIONS)];
    raw.html = [...pool(MIN_LEVEL_QUESTIONS), { q: 'Q0?', options: ['a', 'a', 'b', 'c'], correct: 0 }];
    delete raw.grade11;
    raw.bogus = [];
    expect(() => validateQuestions(raw)).toThrowError(
      new RegExp([
        'database: 10\\.\\.30', 'excel\\[0\\]\\.q', 'excel\\[0\\]\\.options', 'excel\\[0\\]\\.correct',
        'html\\[10\\]\\.q: duplicate', 'html\\[10\\]\\.options: options must be different', 'grade11', 'bogus: unknown',
      ].join('[\\s\\S]*')),
    );
  });

  it('rejects too many questions in a level', () => {
    const raw = good() as Record<string, unknown>;
    raw.css = pool(MAX_LEVEL_QUESTIONS + 1);
    expect(() => validateQuestions(raw)).toThrowError(/css: 10\.\.30/);
  });

  it('rejects non-objects', () => {
    expect(() => validateQuestions(null)).toThrow();
  });
});
