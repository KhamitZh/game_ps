import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/constants';
import {
  ALL_SUBTOPICS, DIFFICULTIES, DIFFICULTY_TITLES, LEVEL_IDS, SUBTOPICS,
  hasSubtopics, isDifficulty, isSubtopic, resolveSelection, subtopicIds,
} from '../src/levels';

describe('subtopics', () => {
  it('lists python subtopics in display order', () => {
    expect(subtopicIds('python')).toEqual(['basics', 'conditions', 'loops', 'strings', 'lists', 'functions']);
    expect(hasSubtopics('python')).toBe(true);
    expect(hasSubtopics('html')).toBe(false);
    expect(subtopicIds('html')).toEqual([]);
  });

  it('has a title in every language for every subtopic and difficulty', () => {
    for (const level of LEVEL_IDS) {
      for (const id of subtopicIds(level)) {
        for (const l of LANGS) expect(SUBTOPICS[level]![id][l].trim(), `${level}.${id}.${l}`).not.toBe('');
      }
    }
    for (const d of DIFFICULTIES) for (const l of LANGS) expect(DIFFICULTY_TITLES[d][l].trim()).not.toBe('');
  });

  it('recognises subtopics per level, including "all"', () => {
    expect(isSubtopic('python', 'loops')).toBe(true);
    expect(isSubtopic('python', ALL_SUBTOPICS)).toBe(true);
    expect(isSubtopic('python', 'bogus')).toBe(false);
    expect(isSubtopic('python', 3)).toBe(false);
    expect(isSubtopic('html', ALL_SUBTOPICS)).toBe(false);
    expect(isSubtopic('python', '__proto__')).toBe(false);
  });

  it('recognises difficulties', () => {
    expect(isDifficulty('hard')).toBe(true);
    expect(isDifficulty('all')).toBe(false);
    expect(isDifficulty(undefined)).toBe(false);
  });
});

describe('resolveSelection', () => {
  it('accepts a full selection for a level with subtopics', () => {
    expect(resolveSelection('python', 'conditions', 'hard')).toEqual({ level: 'python', subtopic: 'conditions', difficulty: 'hard' });
    expect(resolveSelection('python', 'all', 'easy')).toEqual({ level: 'python', subtopic: 'all', difficulty: 'easy' });
  });

  it('rejects missing or invalid parts instead of defaulting', () => {
    expect(resolveSelection('python', undefined, 'easy')).toBeNull();
    expect(resolveSelection('python', 'conditions', undefined)).toBeNull();
    expect(resolveSelection('python', 'conditions', 'all')).toBeNull();
    expect(resolveSelection('python', 'css-selectors', 'easy')).toBeNull();
    expect(resolveSelection('python', ['loops'], 'easy')).toBeNull();
  });

  it('ignores subtopic and difficulty for a level without subtopics', () => {
    expect(resolveSelection('html', 'loops', 'hard')).toEqual({ level: 'html', subtopic: null, difficulty: null });
    expect(resolveSelection('html', undefined, undefined)).toEqual({ level: 'html', subtopic: null, difficulty: null });
  });
});
