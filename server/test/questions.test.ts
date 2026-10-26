import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES, LEVEL_IDS, MAX_LEVEL_QUESTIONS, MIN_LEVEL_QUESTIONS, hasSubtopics, subtopicIds, type Difficulty,
} from '../../shared/src/levels';
import { selectPool, validateQuestions, type Question, type QuestionBank } from '../src/questions';
import bank from '../questions.json';

const pool = (n: number, tag = 'Q', difficulty?: Difficulty): Question[] =>
  Array.from({ length: n }, (_, i) => ({
    q: `${tag}${i}?`, options: ['a', 'b', 'c', 'd'], correct: i % 4, ...(difficulty ? { difficulty } : {}),
  }));
/** Every subtopic gets MIN questions of each difficulty, interleaved hard/easy/medium to prove filtering keeps order. */
const subtopicBank = (level: string) =>
  Object.fromEntries(
    subtopicIds(level as never).map((sub) => [
      sub,
      Array.from({ length: MIN_LEVEL_QUESTIONS }, (_, i) =>
        (['hard', 'easy', 'medium'] as const).map((d) => pool(1, `${level}.${sub}.${d}.${i}.`, d)[0]),
      ).flat(),
    ]),
  );
const good = () =>
  Object.fromEntries(LEVEL_IDS.map((id) => [id, hasSubtopics(id) ? subtopicBank(id) : pool(MIN_LEVEL_QUESTIONS, id)]));

describe('validateQuestions', () => {
  it('accepts a well-formed bank with flat and subtopic levels', () => {
    const v = validateQuestions(good());
    expect((v.numsys as Question[])[1].correct).toBe(1);
    expect((v.python as Record<string, Question[]>).loops).toHaveLength(MIN_LEVEL_QUESTIONS * 3);
  });

  it('accepts the shipped questions.json', () => {
    expect(() => validateQuestions(bank)).not.toThrow();
  });

  it(`ships ${MIN_LEVEL_QUESTIONS}..${MAX_LEVEL_QUESTIONS} questions per flat level and ≥${MIN_LEVEL_QUESTIONS} per subtopic × difficulty`, () => {
    const b = validateQuestions(bank);
    for (const id of LEVEL_IDS) {
      if (hasSubtopics(id)) {
        for (const sub of [...subtopicIds(id), 'all']) {
          for (const difficulty of DIFFICULTIES) {
            expect(selectPool(b, { level: id, subtopic: sub, difficulty }).length, `${id}.${sub}.${difficulty}`)
              .toBeGreaterThanOrEqual(MIN_LEVEL_QUESTIONS);
          }
        }
      } else {
        const n = (b[id] as Question[]).length;
        expect(n, id).toBeGreaterThanOrEqual(MIN_LEVEL_QUESTIONS);
        expect(n, id).toBeLessThanOrEqual(MAX_LEVEL_QUESTIONS);
      }
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

  it('checks subtopic levels: shape, subtopic ids, difficulty tags, pool sizes and duplicates', () => {
    const raw = good() as Record<string, Record<string, Question[]>>;
    raw.python.loops = raw.python.loops.filter((q) => q.difficulty !== 'hard').concat(pool(1, 'L', 'hard'));
    raw.python.strings[0] = { ...raw.python.strings[0], difficulty: 'expert' as Difficulty };
    raw.python.lists.push({ ...raw.python.basics[0] });
    delete (raw.python as Record<string, unknown>).functions;
    (raw.python as Record<string, unknown>).files = pool(MIN_LEVEL_QUESTIONS, 'F', 'easy');
    expect(() => validateQuestions(raw)).toThrowError(
      new RegExp([
        'python\\.loops\\.hard: at least 10',
        'python\\.strings\\[0\\]\\.difficulty',
        'python\\.lists\\[30\\]\\.q: duplicate',
        'python\\.functions: list of questions required',
        'python\\.files: unknown subtopic',
      ].join('[\\s\\S]*')),
    );
  });

  it('rejects a flat list for a level that has subtopics', () => {
    const raw = good() as Record<string, unknown>;
    raw.python = pool(MIN_LEVEL_QUESTIONS, 'P');
    expect(() => validateQuestions(raw)).toThrowError(/python: subtopics object required/);
  });

  it('rejects too many questions in a flat level', () => {
    const raw = good() as Record<string, unknown>;
    raw.css = pool(MAX_LEVEL_QUESTIONS + 1);
    expect(() => validateQuestions(raw)).toThrowError(/css: 10\.\.30/);
  });

  it('rejects non-objects', () => {
    expect(() => validateQuestions(null)).toThrow();
  });
});

describe('selectPool', () => {
  const b = validateQuestions(good()) as QuestionBank;

  it('returns a flat level as is', () => {
    expect(selectPool(b, { level: 'html', subtopic: null, difficulty: null })).toBe(b.html);
  });

  it('filters one subtopic by difficulty, keeping file order', () => {
    const got = selectPool(b, { level: 'python', subtopic: 'conditions', difficulty: 'medium' });
    expect(got).toHaveLength(MIN_LEVEL_QUESTIONS);
    expect(got.every((q) => q.difficulty === 'medium' && q.q.startsWith('python.conditions.'))).toBe(true);
    expect(got.map((q) => q.q)).toEqual([...got.map((q) => q.q)].sort((x, y) => x.localeCompare(y, 'en', { numeric: true })));
  });

  it('joins every subtopic in subtopic order for "all"', () => {
    const got = selectPool(b, { level: 'python', subtopic: 'all', difficulty: 'hard' });
    expect(got).toHaveLength(MIN_LEVEL_QUESTIONS * subtopicIds('python').length);
    expect(got.every((q) => q.difficulty === 'hard')).toBe(true);
    const order = [...new Set(got.map((q) => q.q.split('.')[1]))];
    expect(order).toEqual(subtopicIds('python'));
  });

  it('falls back to every question of the level when a stored game has no subtopic', () => {
    const got = selectPool(b, { level: 'python', subtopic: null, difficulty: null });
    expect(got).toHaveLength(MIN_LEVEL_QUESTIONS * 3 * subtopicIds('python').length);
  });

  it('is deterministic', () => {
    const sel = { level: 'python' as const, subtopic: 'all', difficulty: 'easy' as const };
    expect(selectPool(b, sel).map((q) => q.q)).toEqual(selectPool(b, sel).map((q) => q.q));
  });
});
