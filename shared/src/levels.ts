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
