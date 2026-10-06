import { ROOM_IDS, type RoomId } from '../../shared/src/map';

export interface Question {
  q: string;
  options: string[];
  /** Index (0–3) of the correct option in `options`. Never sent to clients. */
  correct: number;
}
export type QuestionBank = Record<RoomId, Question[]>;

export function validateQuestions(raw: unknown): QuestionBank {
  if (!raw || typeof raw !== 'object') throw new Error('questions.json: a JSON object is expected');
  const errors: string[] = [];
  const bank = {} as QuestionBank;
  for (const id of ROOM_IDS) {
    const list = (raw as Record<string, unknown>)[id];
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${id}: at least one question is required`);
      continue;
    }
    list.forEach((item: unknown, i) => {
      const where = `${id}[${i}]`;
      if (!item || typeof item !== 'object') {
        errors.push(`${where}: object expected`);
        return;
      }
      const { q, options, correct } = item as Record<string, unknown>;
      if (typeof q !== 'string' || !q.trim()) errors.push(`${where}.q: non-empty string required`);
      if (!Array.isArray(options) || options.length !== 4 || options.some((o) => typeof o !== 'string' || !o.trim())) {
        errors.push(`${where}.options: exactly 4 non-empty strings required`);
      }
      if (!Number.isInteger(correct) || (correct as number) < 0 || (correct as number) > 3) {
        errors.push(`${where}.correct: integer 0..3 required`);
      }
    });
    bank[id] = list as Question[];
  }
  if (errors.length) throw new Error(`questions.json is invalid:\n${errors.join('\n')}`);
  return bank;
}
