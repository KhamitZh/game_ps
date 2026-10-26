import { LEVEL_IDS, MAX_LEVEL_QUESTIONS, MIN_LEVEL_QUESTIONS, type LevelId } from '../../shared/src/levels';

export interface Question {
  q: string;
  options: string[];
  /** Index (0–3) of the correct option in `options`. Never sent to clients. */
  correct: number;
}
/** One shared pool per level; a player draws a different question from it in every room. */
export type QuestionBank = Record<LevelId, Question[]>;

export function validateQuestions(raw: unknown): QuestionBank {
  if (!raw || typeof raw !== 'object') throw new Error('questions.json: a JSON object is expected');
  const errors: string[] = [];
  const bank = {} as QuestionBank;
  for (const id of LEVEL_IDS) {
    const list = (raw as Record<string, unknown>)[id];
    if (!Array.isArray(list) || list.length < MIN_LEVEL_QUESTIONS || list.length > MAX_LEVEL_QUESTIONS) {
      errors.push(`${id}: ${MIN_LEVEL_QUESTIONS}..${MAX_LEVEL_QUESTIONS} questions required`);
      if (!Array.isArray(list)) continue;
    }
    const seen = new Set<string>();
    list.forEach((item: unknown, i) => {
      const where = `${id}[${i}]`;
      if (!item || typeof item !== 'object') {
        errors.push(`${where}: object expected`);
        return;
      }
      const { q, options, correct } = item as Record<string, unknown>;
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
    });
    bank[id] = list as Question[];
  }
  for (const key of Object.keys(raw)) {
    if (!(LEVEL_IDS as readonly string[]).includes(key)) errors.push(`${key}: unknown level id`);
  }
  if (errors.length) throw new Error(`questions.json is invalid:\n${errors.join('\n')}`);
  return bank;
}
