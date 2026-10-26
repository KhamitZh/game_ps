import { TOTAL_ROOMS, type Lang } from './constants';

/** A level is one subject module; every game is played on one level's question pool. */
export const LEVEL_IDS = [
  'numsys', 'database', 'excel', 'python', 'html', 'css', 'js', 'computer', 'networks', 'grade11',
] as const;
export type LevelId = (typeof LEVEL_IDS)[number];
export const DEFAULT_LEVEL: LevelId = 'numsys';

/** Each player gets a different question in every room, so a level needs at least one per room. */
export const MIN_LEVEL_QUESTIONS = TOTAL_ROOMS;
export const MAX_LEVEL_QUESTIONS = 30;

export const LEVEL_TITLES: Record<LevelId, Record<Lang, string>> = {
  numsys: { kk: 'Санау жүйелері', ru: 'Системы счисления', en: 'Number systems' },
  database: { kk: 'Деректер қоры', ru: 'Базы данных', en: 'Databases' },
  excel: { kk: 'Электрондық кесте (Excel)', ru: 'Электронные таблицы (Excel)', en: 'Spreadsheets (Excel)' },
  python: { kk: 'Python', ru: 'Python', en: 'Python' },
  html: { kk: 'HTML', ru: 'HTML', en: 'HTML' },
  css: { kk: 'CSS', ru: 'CSS', en: 'CSS' },
  js: { kk: 'JavaScript', ru: 'JavaScript', en: 'JavaScript' },
  computer: { kk: 'Компьютер', ru: 'Компьютер', en: 'Computer hardware' },
  networks: { kk: 'Компьютерлік желілер', ru: 'Компьютерные сети', en: 'Computer networks' },
  grade11: { kk: '11-сынып тақырыптары', ru: 'Темы 11 класса', en: 'Grade 11 topics' },
};

export function isLevelId(v: unknown): v is LevelId {
  return typeof v === 'string' && (LEVEL_IDS as readonly string[]).includes(v);
}

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const DEFAULT_DIFFICULTY: Difficulty = 'easy';

export const DIFFICULTY_TITLES: Record<Difficulty, Record<Lang, string>> = {
  easy: { kk: 'Жеңіл', ru: 'Лёгкий', en: 'Easy' },
  medium: { kk: 'Орташа', ru: 'Средний', en: 'Medium' },
  hard: { kk: 'Қиын', ru: 'Сложный', en: 'Hard' },
};

/** Picks every subtopic of the level at once. */
export const ALL_SUBTOPICS = 'all';

/** Subtopic ids and titles of the levels split into subtopics; key order is the display order. */
export const SUBTOPICS: Partial<Record<LevelId, Record<string, Record<Lang, string>>>> = {
  python: {
    basics: { kk: 'Айнымалылар және амалдар', ru: 'Переменные и операции', en: 'Variables and operators' },
    conditions: { kk: 'Шарттар', ru: 'Условия', en: 'Conditions' },
    loops: { kk: 'Циклдар', ru: 'Циклы', en: 'Loops' },
    strings: { kk: 'Жолдар', ru: 'Строки', en: 'Strings' },
    lists: { kk: 'Тізімдер (массивтер)', ru: 'Списки (массивы)', en: 'Lists (arrays)' },
    functions: { kk: 'Функциялар', ru: 'Функции', en: 'Functions' },
  },
};

export function subtopicIds(level: LevelId): string[] {
  return Object.keys(SUBTOPICS[level] ?? {});
}

export function hasSubtopics(level: LevelId): boolean {
  return subtopicIds(level).length > 0;
}

export function isSubtopic(level: LevelId, v: unknown): v is string {
  return typeof v === 'string' && hasSubtopics(level) && (v === ALL_SUBTOPICS || subtopicIds(level).includes(v));
}

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v);
}

/** What a game draws its questions from. Levels without subtopics carry nulls. */
export interface PoolSelection {
  level: LevelId;
  subtopic: string | null;
  difficulty: Difficulty | null;
}

/** null means the request did not name a valid subtopic and difficulty for a level that needs them. */
export function resolveSelection(level: LevelId, subtopic: unknown, difficulty: unknown): PoolSelection | null {
  if (!hasSubtopics(level)) return { level, subtopic: null, difficulty: null };
  if (!isSubtopic(level, subtopic) || !isDifficulty(difficulty)) return null;
  return { level, subtopic, difficulty };
}
