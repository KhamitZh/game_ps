import {
  ALL_SUBTOPICS, DIFFICULTIES, LEVEL_IDS, MAX_LEVEL_QUESTIONS, MIN_LEVEL_QUESTIONS,
  hasSubtopics, isDifficulty, subtopicIds, type Difficulty, type LevelId, type PoolSelection,
} from '../../shared/src/levels';

export interface Question {
  q: string;
  options: string[];
  /** Index (0–3) of the correct option in `options`. Never sent to clients. */
  correct: number;
  /** Present on every question of a level that is split into subtopics. */
  difficulty?: Difficulty;
}
/** A flat pool, or one pool per subtopic with a difficulty on every question. */
export type LevelQuestions = Question[] | Record<string, Question[]>;
export type QuestionBank = Record<LevelId, LevelQuestions>;

function checkQuestion(item: unknown, where: string, seen: Set<string>, errors: string[], needsDifficulty: boolean): void {
  if (!item || typeof item !== 'object') {
    errors.push(`${where}: object expected`);
    return;
  }
  const { q, options, correct, difficulty } = item as Record<string, unknown>;
  if (typeof q !== 'string' || !q.trim()) errors.push(`${where}.q: non-empty string required`);
  else if (seen.has(q.trim())) errors.push(`${where}.q: duplicate question in this level`);
  else seen.add(q.trim());
  if (!Array.isArray(options) || options.length !== 4 || options.some((o) => typeof o !== 'string' || !o.trim())) {
    errors.push(`${where}.options: exactly 4 non-empty strings required`);
  } else if (new Set(options.map((o: string) => o.trim())).size !== 4) {
    errors.push(`${where}.options: options must be different`);
  }
  if (!Number.isInteger(correct) || (correct as number) < 0 || (correct as number) > 3) {
    errors.push(`${where}.correct: integer 0..3 required`);
  }
  if (needsDifficulty && !isDifficulty(difficulty)) errors.push(`${where}.difficulty: ${DIFFICULTIES.join('|')} required`);
}

function checkSubtopicLevel(id: LevelId, entry: unknown, errors: string[]): void {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${id}: subtopics object required`);
    return;
  }
  const subs = subtopicIds(id);
  const seen = new Set<string>();
  for (const sub of subs) {
    const list = (entry as Record<string, unknown>)[sub];
    if (!Array.isArray(list)) {
      errors.push(`${id}.${sub}: list of questions required`);
      continue;
    }
    list.forEach((item: unknown, i) => checkQuestion(item, `${id}.${sub}[${i}]`, seen, errors, true));
    for (const d of DIFFICULTIES) {
      const n = list.filter((x) => (x as Question | null)?.difficulty === d).length;
      if (n < MIN_LEVEL_QUESTIONS) errors.push(`${id}.${sub}.${d}: at least ${MIN_LEVEL_QUESTIONS} questions required`);
    }
  }
  for (const key of Object.keys(entry)) {
    if (!subs.includes(key)) errors.push(`${id}.${key}: unknown subtopic`);
  }
}

function checkFlatLevel(id: LevelId, list: unknown, errors: string[]): void {
  if (!Array.isArray(list) || list.length < MIN_LEVEL_QUESTIONS || list.length > MAX_LEVEL_QUESTIONS) {
    errors.push(`${id}: ${MIN_LEVEL_QUESTIONS}..${MAX_LEVEL_QUESTIONS} questions required`);
    if (!Array.isArray(list)) return;
  }
  const seen = new Set<string>();
  list.forEach((item: unknown, i) => checkQuestion(item, `${id}[${i}]`, seen, errors, false));
}

export function validateQuestions(raw: unknown): QuestionBank {
  if (!raw || typeof raw !== 'object') throw new Error('questions.json: a JSON object is expected');
  const errors: string[] = [];
  for (const id of LEVEL_IDS) {
    const entry = (raw as Record<string, unknown>)[id];
    if (hasSubtopics(id)) checkSubtopicLevel(id, entry, errors);
    else checkFlatLevel(id, entry, errors);
  }
  for (const key of Object.keys(raw)) {
    if (!(LEVEL_IDS as readonly string[]).includes(key)) errors.push(`${key}: unknown level id`);
  }
  if (errors.length) throw new Error(`questions.json is invalid:\n${errors.join('\n')}`);
  return raw as QuestionBank;
}

/**
 * The questions a game draws from. Never reorders anything: stored `qIndex` values must keep
 * pointing at the same question after the Durable Object reloads.
 */
export function selectPool(bank: QuestionBank, sel: PoolSelection): Question[] {
  const entry = bank[sel.level];
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  // A game stored before the level was split carries no subtopic: keep it playable with everything.
  if (sel.subtopic === null || sel.difficulty === null) return subtopicIds(sel.level).flatMap((s) => entry[s] ?? []);
  const subs = sel.subtopic === ALL_SUBTOPICS ? subtopicIds(sel.level) : [sel.subtopic];
  return subs.flatMap((s) => entry[s] ?? []).filter((q) => q.difficulty === sel.difficulty);
}
