# Subtopics and Difficulty (Python pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating a game the host picks topic → subtopic (or "all") → difficulty, and players get questions only from that pool; Python ships with 6 subtopics × 3 difficulties × 10 questions.

**Architecture:** Subtopic/difficulty metadata (ids, titles, validation of a requested selection) lives in `shared/src/levels.ts` so client and server agree. `server/questions.json` stores a subtopic-level as `{ subtopic: Question[] }` with a `difficulty` tag per question; other levels stay flat lists. The server stores only the *selection* in `GameData` and recomputes the pool deterministically with `selectPool`, so persisted `qIndex` values stay valid.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects, Vite + vanilla DOM (host page), Vitest, Playwright, Python 3 (question generator).

**Spec:** `docs/superpowers/specs/2026-10-27-subtopics-difficulty-design.md`

## Global Constraints

- Difficulty ids: `easy | medium | hard`; default in the UI `easy`. No "mixed" option.
- "All subtopics" id: `all`; it is the UI default subtopic.
- Python subtopic ids, in this order: `basics, conditions, loops, strings, lists, functions`.
- Every subtopic × difficulty pool has ≥ `MIN_LEVEL_QUESTIONS` (10) questions; Python ships exactly 10 each (180 total).
- Invalid/missing subtopic or difficulty for a level that has subtopics → HTTP 400 `{ error: 'BAD_SELECTION' }`, checked after the password. Never silently default.
- Levels without subtopics keep today's format and rules (flat list, 10..30) and get `subtopic: null, difficulty: null`.
- Correct answers never leave the server; player-facing messages do not change.
- User-visible strings exist in kk, ru and en (the i18n test enforces identical key sets).
- Commit on branch `feat/subtopics-difficulty`; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not run `wrangler deploy` — the user deploys.

## Review Focus

1. A game persisted before this deploy (`level: 'python'`, no `subtopic`/`difficulty`) is reloaded: it must not crash; `answer` on a `qIndex` outside the new pool returns `NO_QUESTION`. → Task 4, Step 1.
2. `all` + `hard` must return only hard questions, drawn from every subtopic in subtopic order (so indices are stable across restarts). → Task 3, Step 1.
3. Cross-level/garbage selections: a Python request with `subtopic: 'all'` as difficulty, a subtopic id that belongs to nothing, or a non-string; an HTML request that sends a subtopic (ignored → nulls). → Task 1, Step 1.
4. Host switches Python → HTML → Python: the subtopic row hides and reappears, subtopic resets to "all", difficulty keeps the last choice; an HTML game shows only the topic in the header. → Task 6, Step 3.
5. Host changes language on the login form after choosing subtopic and difficulty: the form re-renders with the same choices. → Task 5 (state is written to `s` on every change event, never read back from the DOM after re-render) and Task 6, Step 3.

---

### Task 1: Shared subtopic/difficulty metadata

**Files:**
- Modify: `shared/src/levels.ts`
- Create: `shared/test/levels.test.ts`

**Interfaces:**
- Produces (all exported from `shared/src/levels.ts`):
  - `DIFFICULTIES: readonly ['easy','medium','hard']`, `type Difficulty`, `DEFAULT_DIFFICULTY: Difficulty`
  - `ALL_SUBTOPICS = 'all'`
  - `SUBTOPICS: Partial<Record<LevelId, Record<string, Record<Lang, string>>>>`
  - `DIFFICULTY_TITLES: Record<Difficulty, Record<Lang, string>>`
  - `subtopicIds(level: LevelId): string[]`
  - `hasSubtopics(level: LevelId): boolean`
  - `isSubtopic(level: LevelId, v: unknown): v is string` (true for `'all'` when the level has subtopics)
  - `isDifficulty(v: unknown): v is Difficulty`
  - `interface PoolSelection { level: LevelId; subtopic: string | null; difficulty: Difficulty | null }`
  - `resolveSelection(level: LevelId, subtopic: unknown, difficulty: unknown): PoolSelection | null`

- [ ] **Step 1: Write the failing test** — `shared/test/levels.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/test/levels.test.ts`
Expected: FAIL — `subtopicIds` / `resolveSelection` are not exported.

- [ ] **Step 3: Implement** — append to `shared/src/levels.ts`

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run shared/test/levels.test.ts && npx tsc -p shared`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add shared/src/levels.ts shared/test/levels.test.ts
git commit -m "feat(shared): subtopic and difficulty metadata with selection validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Question generator in the repo + 180 Python questions

The generator currently lives only in the session scratchpad
(`/tmp/claude-1000/-home-khamit-dev-g-ps/acf04036-6ad2-44cf-93eb-3452a0a8d405/scratchpad/build_questions.py`).
It must move into the repo because later phases fill the other topics with it.

**Files:**
- Create: `server/scripts/build_questions.py` (copy of the scratchpad generator, then modified)

**Interfaces:**
- Consumes: nothing from earlier tasks (pure Python).
- Produces: running `python3 server/scripts/build_questions.py <out.json>` writes a bank where `python` is
  `{ "basics": [...], "conditions": [...], ... }` and every Python question has `"difficulty"`. Task 3 runs it
  with `server/questions.json` as the output.

- [ ] **Step 1: Copy the generator**

```bash
/bin/cp -f /tmp/claude-1000/-home-khamit-dev-g-ps/acf04036-6ad2-44cf-93eb-3452a0a8d405/scratchpad/build_questions.py server/scripts/build_questions.py
python3 server/scripts/build_questions.py /tmp/claude-1000/-home-khamit-dev-g-ps/acf04036-6ad2-44cf-93eb-3452a0a8d405/scratchpad/q_before.json
cmp /tmp/claude-1000/-home-khamit-dev-g-ps/acf04036-6ad2-44cf-93eb-3452a0a8d405/scratchpad/q_before.json server/questions.json && echo SAME
```
Expected: prints the per-level counts and `SAME` (the generator reproduces today's file).

- [ ] **Step 2: Add the subtopic format to the generator**

Replace the `L['python'] = [...]` block with a dict keyed by subtopic, where each entry is
`(difficulty, question, [4 options], correct_index[, check])`:

```python
SUBTOPICS = {'python': ['basics', 'conditions', 'loops', 'strings', 'lists', 'functions']}
DIFFICULTIES = ('easy', 'medium', 'hard')
PER_POOL = 10

L['python'] = {
    'basics': [
        ('easy', 'Программа нені шығарады?\nprint(7 // 2)', ['3.5', '3', '4', '1'], 1, ('py', 'print(7 // 2)')),
        # ... 10 easy, 10 medium, 10 hard
    ],
    'conditions': [...],
    'loops': [...],
    'strings': [...],
    'lists': [...],
    'functions': [...],
}
```

Replace the build loop at the bottom with one that handles both shapes:

```python
def build_item(where, item, difficulty=None):
    q, opts, correct = item[0], item[1], item[2]
    if len(opts) != 4 or len(set(opts)) != 4:
        errors.append(f'{where}: bad options: {q}')
    if len(item) > 3:
        kind, payload = item[3]
        got = run_py(payload) if kind == 'py' else run_js(payload) if kind == 'js' else payload
        if got != opts[correct]:
            errors.append(f'{where}: {q!r}\n   computed {got!r}, marked {opts[correct]!r}')
    out = {'q': q, 'options': opts, 'correct': correct}
    if difficulty:
        out['difficulty'] = difficulty
    return out


bank, errors, seen = {}, [], {}
for level, items in L.items():
    texts = seen.setdefault(level, set())
    if isinstance(items, dict):
        if list(items) != SUBTOPICS[level]:
            errors.append(f'{level}: subtopics must be exactly {SUBTOPICS[level]} in that order')
        bank[level] = {}
        for sub, entries in items.items():
            for d in DIFFICULTIES:
                n = sum(1 for e in entries if e[0] == d)
                if n < PER_POOL:
                    errors.append(f'{level}.{sub}.{d}: {n} questions (need {PER_POOL})')
            for e in entries:
                if e[0] not in DIFFICULTIES:
                    errors.append(f'{level}.{sub}: bad difficulty {e[0]!r}')
                if e[1] in texts:
                    errors.append(f'{level}.{sub}: duplicate {e[1]!r}')
                texts.add(e[1])
            bank[level][sub] = [build_item(f'{level}.{sub}', e[1:], e[0]) for e in entries]
    else:
        out = [build_item(level, it) for it in items]
        if not 10 <= len(out) <= 30:
            errors.append(f'{level}: {len(out)} questions')
        bank[level] = out

if errors:
    print('\n'.join(errors))
    sys.exit(1)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(bank, f, ensure_ascii=False, indent=2)
    f.write('\n')


def flat(v):
    return [e for es in v.values() for e in es] if isinstance(v, dict) else v


checked = sum(1 for items in L.values() for it in flat(items) if len(it) > (4 if isinstance(items, dict) else 3))
print({k: (len(flat(v)) if isinstance(v, list) else {s: len(es) for s, es in v.items()}) for k, v in bank.items()},
      'machine-checked', checked)
```

- [ ] **Step 3: Write the 180 Python questions**

Fill `L['python']` with exactly 10 per subtopic × difficulty. Rules:

- Every "what does it print" question carries a `('py', code)` check whose code is the snippet shown in the question text.
- Every question with a computable answer gets a check; only conceptual questions ("which keyword…") go without.
- Difficulty:
  - **easy**: one concept, 1–3 lines (`print(7 // 2)`, `len("Python")`, `if 5 > 3: print("A")`).
  - **medium**: 2–3 concepts or 4–6 lines (an `elif` chain, summing in a `for` loop, `s[1:4]`, `lst.append` then `len`).
  - **hard**: nested structures, tracing, edge cases (`for … else` with `break`, `s[::-2]`, list aliasing `b = a; b.append(1)`, default argument values, `while` with changing step, 2D list indexing `m[1][-1]`).
- Subtopic content per spec table: `basics` (types, input/print, `//`, `%`, `**`, conversions), `conditions` (`if/elif/else`, comparisons, `and/or/not`, nesting), `loops` (`for`, `range`, `while`, `break/continue`, tracing), `strings` (index, slices, `len`, `upper`, `count`, `replace`), `lists` (1D/2D, `append`, `sort`, search), `functions` (`def`, `return`, parameters, defaults).
- Reuse the 24 existing Python questions: tag each with a difficulty and put it in the matching subtopic; drop the ones that duplicate a new question.
- Text in Kazakh, terms as in the grade 7–10 textbooks; wrong options must be plausible mistakes (e.g. `3.5` for `7 // 2`).

- [ ] **Step 4: Run the generator**

Run: `python3 server/scripts/build_questions.py /tmp/claude-1000/-home-khamit-dev-g-ps/acf04036-6ad2-44cf-93eb-3452a0a8d405/scratchpad/q_new.json`
Expected: exit 0; python shows `{'basics': 30, 'conditions': 30, 'loops': 30, 'strings': 30, 'lists': 30, 'functions': 30}`; other levels unchanged.
Do **not** write `server/questions.json` yet — the current validator rejects the new shape (Task 3 does it).

- [ ] **Step 5: Commit**

```bash
git add server/scripts/build_questions.py
git commit -m "feat(questions): Python bank split into subtopics and difficulties

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server question bank format, validator and `selectPool`

**Files:**
- Modify: `server/src/questions.ts`
- Modify: `server/src/game.ts:273,295` (interim: read the pool through `selectPool`)
- Modify: `server/questions.json` (regenerated)
- Test: `server/test/questions.test.ts`

**Interfaces:**
- Consumes: from Task 1 `ALL_SUBTOPICS`, `DIFFICULTIES`, `hasSubtopics`, `subtopicIds`, `isDifficulty`, `PoolSelection`, `Difficulty`.
- Produces (from `server/src/questions.ts`):
  - `interface Question { q: string; options: string[]; correct: number; difficulty?: Difficulty }`
  - `type LevelQuestions = Question[] | Record<string, Question[]>`
  - `type QuestionBank = Record<LevelId, LevelQuestions>`
  - `validateQuestions(raw: unknown): QuestionBank`
  - `selectPool(bank: QuestionBank, sel: PoolSelection): Question[]`

- [ ] **Step 1: Write the failing tests** — replace `server/test/questions.test.ts`

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/test/questions.test.ts`
Expected: FAIL — `selectPool` is not exported; validator rejects `python` as an object.

- [ ] **Step 3: Implement** — replace `server/src/questions.ts`

```ts
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
```

- [ ] **Step 4: Interim adaptation of `server/src/game.ts`** (Task 4 replaces it)

In `server/src/game.ts` add `selectPool` to the import from `./questions`, then:

```ts
// line ~273 in interact()
const pool = selectPool(this.questions, { level: this.level, subtopic: null, difficulty: null });
```

```ts
// line ~295 in answer()
const q = selectPool(this.questions, { level: this.level, subtopic: null, difficulty: null })[a.qIndex];
if (!q) return fail('NO_QUESTION');
const correct = a.order[optionIndex] === q.correct;
```

- [ ] **Step 5: Regenerate `server/questions.json`**

Run: `python3 server/scripts/build_questions.py server/questions.json`
Expected: exit 0, same counts as Task 2 Step 4.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run server && npx tsc -p server`
Expected: PASS (the existing `game.test.ts` BANK is flat lists, still valid for `QuestionBank`); no type errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/questions.ts server/src/game.ts server/questions.json server/test/questions.test.ts
git commit -m "feat(server): subtopic question bank with difficulty tags and selectPool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Game carries the selection (Game, GameRoom, worker, protocol)

**Files:**
- Modify: `server/src/game.ts` (constructor, `GameData`, `fromData`, `toData`, `interact`, `answer`)
- Modify: `server/src/GameRoom.ts:38-46` (`init`), `:112-121` (`hostWelcome`)
- Modify: `server/src/worker.ts:39-64` (`createGame`)
- Modify: `shared/src/protocol.ts:11-15` (`ERROR_CODES`), `:70` (`hostWelcome`)
- Modify: `client/src/i18n/kk.json`, `ru.json`, `en.json` (`error.BAD_SELECTION` — required by the i18n test)
- Test: `server/test/game.test.ts`

**Interfaces:**
- Consumes: Task 1 `PoolSelection`, `resolveSelection`, `DEFAULT_LEVEL`, `Difficulty`; Task 3 `selectPool`, `QuestionBank`, `Question`.
- Produces:
  - `new Game(pin, hostToken, timeLimitMin, selection: PoolSelection, questions: QuestionBank, deps)`
  - `game.selection: PoolSelection` (readonly) and `get level(): LevelId`
  - `GameData` gains `subtopic?: string | null; difficulty?: Difficulty | null`
  - `GameRoom.init(opts: { pin: string; timeLimitMin: number; selection: PoolSelection; hostToken: string })`
  - `POST /api/create` → `{ pin, hostToken, timeLimitMin, level, subtopic, difficulty }` or `400 { error: 'BAD_SELECTION' }`
  - `ServerMsg` `hostWelcome` gains `subtopic: string | null; difficulty: Difficulty | null`
  - `ERROR_CODES` gains `'BAD_SELECTION'`

- [ ] **Step 1: Write the failing tests** — edit `server/test/game.test.ts`

Change the bank and `newGame` at the top:

```ts
import { LEVEL_IDS, type PoolSelection } from '../../shared/src/levels';
// ...
const NUMSYS: PoolSelection = { level: 'numsys', subtopic: null, difficulty: null };
const newGame = (limitMin = 10, sel: PoolSelection = NUMSYS) => new Game('123456', 'host-token', limitMin, sel, BANK, deps());
```

Replace the `BANK` construction so `python` uses subtopics (one question per room in `conditions/hard`, decoys elsewhere):

```ts
const tag = (d: 'easy' | 'medium' | 'hard', prefix: string) =>
  POOL.map((x) => ({ ...x, q: `${prefix}-${x.q}`, difficulty: d }));
const PY = {
  basics: [...tag('easy', 'b-e'), ...tag('medium', 'b-m'), ...tag('hard', 'b-h')],
  conditions: [...tag('easy', 'c-e'), ...tag('medium', 'c-m'), ...tag('hard', 'c-h')],
  loops: [], strings: [], lists: [], functions: [],
};
const BANK = Object.fromEntries(LEVEL_IDS.map((id) => [id, id === 'python' ? PY : POOL])) as QuestionBank;
```

`displayedCorrect` must look the question up in the game's pool — change it to:

```ts
function displayedCorrect(g: Game, id: string, roomId: RoomId) {
  const a = g.players.get(id)!.assigned[roomId]!;
  return a.order.indexOf(selectPool(BANK, g.selection)[a.qIndex].correct);
}
```
(add `import { selectPool, type QuestionBank } from '../src/questions';`)

Replace the body of the existing test "draws questions from the level the game was created with" (line ~264) with:

```ts
  it('draws questions only from the selected subtopic and difficulty', () => {
    const g = newGame(10, { level: 'python', subtopic: 'conditions', difficulty: 'hard' });
    const p = join(g, 'Aru');
    startPlaying(g);
    for (const roomId of ROOM_IDS) {
      standAt(g, p.id, roomId);
      const r = g.interact(p.id, roomId);
      if (!r.ok) throw new Error(r.code);
      expect(r.question.q.startsWith('c-h-'), r.question.q).toBe(true);
      expect(solve(g, p.id, roomId).ok).toBe(true);
    }
    expect(g.players.get(p.id)!.keys).toBe(ROOM_IDS.length);
  });

  it('draws from every subtopic for "all"', () => {
    rngValues = Array(ROOM_IDS.length).fill(0.99);
    const g = newGame(10, { level: 'python', subtopic: 'all', difficulty: 'easy' });
    const p = join(g, 'Aru');
    startPlaying(g);
    const seen = ROOM_IDS.map((roomId) => {
      standAt(g, p.id, roomId);
      const r = g.interact(p.id, roomId);
      if (!r.ok) throw new Error(r.code);
      return r.question.q;
    });
    expect(seen.every((q) => q.startsWith('b-e-') || q.startsWith('c-e-'))).toBe(true);
    expect(seen.some((q) => q.startsWith('c-e-'))).toBe(true);
  });
```

Extend the persistence test (line ~443) and add the legacy-data test:

```ts
  it('round-trips the selection through toData/fromData', () => {
    const sel: PoolSelection = { level: 'python', subtopic: 'conditions', difficulty: 'medium' };
    const g2 = Game.fromData(JSON.parse(JSON.stringify(newGame(10, sel).toData())), BANK, deps());
    expect(g2.selection).toEqual(sel);
    expect(g2.level).toBe('python');
  });

  it('keeps a game stored before subtopics existed playable', () => {
    const g = newGame(10, { level: 'python', subtopic: 'conditions', difficulty: 'hard' });
    const p = join(g, 'Aru');
    startPlaying(g);
    expect(solve(g, p.id, ROOM_IDS[0]).ok).toBe(true);
    const data = JSON.parse(JSON.stringify(g.toData()));
    delete data.subtopic;
    delete data.difficulty;
    data.players[0].assigned[ROOM_IDS[1]] = { qIndex: 9999, order: [0, 1, 2, 3] };
    const g2 = Game.fromData(data, BANK, deps());
    expect(g2.selection).toEqual({ level: 'python', subtopic: null, difficulty: null });
    standAt(g2, p.id, ROOM_IDS[1]);
    expect(g2.answer(p.id, ROOM_IDS[1], 0)).toEqual({ ok: false, code: 'NO_QUESTION' });
  });
```

(`answer` checks only `phase === 'PLAYING'` and `status === 'playing'`, both survive `fromData`; it does not require the player to be online or near the pedestal.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/test/game.test.ts`
Expected: FAIL — the constructor still takes a `LevelId`; `g.selection` is undefined.

- [ ] **Step 3: Implement `server/src/game.ts`**

```ts
import { DEFAULT_LEVEL, type Difficulty, type LevelId, type PoolSelection } from '../../shared/src/levels';
import { selectPool, type Question, type QuestionBank } from './questions';
```

`GameData`: after `level: LevelId;` add

```ts
  /** Missing in games stored before subtopics existed. */
  subtopic?: string | null;
  difficulty?: Difficulty | null;
```

Constructor and pool:

```ts
  private readonly pool: Question[];

  constructor(
    readonly pin: string,
    readonly hostToken: string,
    readonly timeLimitMin: number,
    readonly selection: PoolSelection,
    questions: QuestionBank,
    private readonly deps: GameDeps,
  ) {
    this.pool = selectPool(questions, selection);
  }

  get level(): LevelId {
    return this.selection.level;
  }

  static fromData(d: GameData, questions: QuestionBank, deps: GameDeps): Game {
    const selection: PoolSelection = { level: d.level ?? DEFAULT_LEVEL, subtopic: d.subtopic ?? null, difficulty: d.difficulty ?? null };
    const g = new Game(d.pin, d.hostToken, d.timeLimitMin, selection, questions, deps);
```

`toData`: replace `level: this.level,` with

```ts
      level: this.selection.level,
      subtopic: this.selection.subtopic,
      difficulty: this.selection.difficulty,
```

`interact`: replace the interim `const pool = selectPool(...)` line with `const pool = this.pool;`.
`answer`: replace the interim lookup with `const q = this.pool[a.qIndex];` (keep the `if (!q) return fail('NO_QUESTION');`).

- [ ] **Step 4: Implement protocol, GameRoom, worker**

`shared/src/protocol.ts` — add `'BAD_SELECTION'` at the end of `ERROR_CODES`; change the import to
`import type { Difficulty, LevelId } from './levels';` and the `hostWelcome` member to:

```ts
  | { t: 'hostWelcome'; pin: string; timeLimitMin: number; level: LevelId; subtopic: string | null; difficulty: Difficulty | null; phase: PhaseInfo; roster: PublicPlayer[]; ranking: RankedPlayer[] | null }
```

`server/src/GameRoom.ts`:

```ts
import type { PoolSelection } from '../../shared/src/levels';
// ...
  async init(opts: { pin: string; timeLimitMin: number; selection: PoolSelection; hostToken: string }): Promise<boolean> {
    // ...
    this.game = new Game(opts.pin, opts.hostToken, opts.timeLimitMin, opts.selection, QUESTIONS, this.deps);
```

and in the `hostWelcome` send:

```ts
          level: game.selection.level,
          subtopic: game.selection.subtopic,
          difficulty: game.selection.difficulty,
```

`server/src/worker.ts` — import `resolveSelection`; in `createGame` widen the body type to
`{ password?: unknown; timeLimitMin?: unknown; level?: unknown; subtopic?: unknown; difficulty?: unknown }` and replace
from `const level = ...` to the end of the loop:

```ts
  const level = isLevelId(body.level) ? body.level : DEFAULT_LEVEL;
  const selection = resolveSelection(level, body.subtopic, body.difficulty);
  if (!selection) return json(env, { error: 'BAD_SELECTION' }, 400);
  const hostToken = crypto.randomUUID();
  for (let attempt = 0; attempt < 10; attempt++) {
    const pin = randomPin();
    if (await room(env, pin).init({ pin, timeLimitMin, selection, hostToken })) {
      return json(env, { pin, hostToken, timeLimitMin, ...selection });
    }
  }
```

i18n — add after `"error.BUSY"` in each file:
- kk: `"error.BAD_SELECTION": "Бөлім мен қиындықты таңдаңыз",`
- ru: `"error.BAD_SELECTION": "Выберите раздел и сложность",`
- en: `"error.BAD_SELECTION": "Choose a subtopic and difficulty",`

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS. (`client/src/host/main.ts` still compiles: it reads `m.level` only; `createGame` still sends `level`.)

- [ ] **Step 6: Commit**

```bash
git add server/src shared/src/protocol.ts server/test/game.test.ts client/src/i18n
git commit -m "feat(server): games are created on a subtopic and difficulty selection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Host page — subtopic and difficulty pickers

**Files:**
- Modify: `client/src/net/api.ts`
- Modify: `client/src/host/main.ts` (state, `renderLogin`, submit, `hostWelcome`, dashboard header)
- Modify: `client/src/ui/styles.css` (segmented radio buttons)
- Modify: `client/src/i18n/kk.json`, `ru.json`, `en.json`

**Interfaces:**
- Consumes: Task 1 `ALL_SUBTOPICS`, `DEFAULT_DIFFICULTY`, `DIFFICULTIES`, `DIFFICULTY_TITLES`, `SUBTOPICS`, `hasSubtopics`, `subtopicIds`, `PoolSelection`, `Difficulty`; Task 4 `/api/create` contract and `hostWelcome` fields.
- Produces: `createGame(password: string, timeLimitMin: number, selection: PoolSelection): Promise<CreateResult>` where the ok branch is `{ ok: true; pin: string; hostToken: string; timeLimitMin: number; selection: PoolSelection }`. DOM ids used by Task 6: `#lv`, `#st`, `#subRow`, `input[name=diff]`, `.seg-opt`.

- [ ] **Step 1: `client/src/net/api.ts`**

```ts
import type { PoolSelection } from '../../../shared/src/levels';
// ...
export type CreateResult =
  | { ok: true; pin: string; hostToken: string; timeLimitMin: number; selection: PoolSelection }
  | { ok: false; code: ErrorCode | 'NETWORK' };

export async function createGame(password: string, timeLimitMin: number, selection: PoolSelection): Promise<CreateResult> {
  const r = await fetch(`${SERVER_URL}/api/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, timeLimitMin, ...selection }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok) {
    const selection = { level: body.level, subtopic: body.subtopic ?? null, difficulty: body.difficulty ?? null };
    return { ok: true, pin: body.pin, hostToken: body.hostToken, timeLimitMin: body.timeLimitMin, selection };
  }
  return { ok: false, code: body.error ?? 'NETWORK' };
}
```

- [ ] **Step 2: i18n keys** (after `"host.level"` in each file)

- kk: `"host.subtopic": "Бөлім",` `"host.difficulty": "Қиындық",` `"host.allSubtopics": "Барлық бөлімдер",`
- ru: `"host.subtopic": "Раздел",` `"host.difficulty": "Сложность",` `"host.allSubtopics": "Все разделы",`
- en: `"host.subtopic": "Subtopic",` `"host.difficulty": "Difficulty",` `"host.allSubtopics": "All subtopics",`

- [ ] **Step 3: `client/src/host/main.ts` — state and title helpers**

Imports:

```ts
import {
  ALL_SUBTOPICS, DEFAULT_DIFFICULTY, DEFAULT_LEVEL, DIFFICULTIES, DIFFICULTY_TITLES, LEVEL_IDS, LEVEL_TITLES, SUBTOPICS,
  hasSubtopics, subtopicIds, type Difficulty, type LevelId, type PoolSelection,
} from '../../../shared/src/levels';
```

State — replace `level: DEFAULT_LEVEL as LevelId,` with:

```ts
  /** Form choices; kept here so a re-render (language switch, error) shows the same choices. */
  level: DEFAULT_LEVEL as LevelId,
  subtopic: ALL_SUBTOPICS as string,
  difficulty: DEFAULT_DIFFICULTY as Difficulty,
  /** What the running game was created with (from hostWelcome). */
  game: { level: DEFAULT_LEVEL, subtopic: null, difficulty: null } as PoolSelection,
```

Helpers after `levelTitle`:

```ts
function subtopicTitle(level: LevelId, id: string): string {
  return id === ALL_SUBTOPICS ? t('host.allSubtopics') : SUBTOPICS[level]?.[id]?.[getLang()] ?? id;
}

function selectionTitle(sel: PoolSelection): string {
  const parts = [levelTitle(sel.level)];
  if (sel.subtopic) parts.push(subtopicTitle(sel.level, sel.subtopic));
  if (sel.difficulty) parts.push(DIFFICULTY_TITLES[sel.difficulty][getLang()]);
  return parts.join(' › ');
}

function subtopicOptions(level: LevelId): string {
  return [ALL_SUBTOPICS, ...subtopicIds(level)]
    .map((id) => `<option value="${id}"${id === s.subtopic ? ' selected' : ''}>${escapeHtml(subtopicTitle(level, id))}</option>`)
    .join('');
}
```

- [ ] **Step 4: `renderLogin` markup and listeners**

After the `#lv` `<select>` insert:

```ts
        <div id="subRow" class="stack"${hasSubtopics(s.level) ? '' : ' hidden'}>
          <label class="label" for="st">${t('host.subtopic')}</label>
          <select id="st" class="input">${subtopicOptions(s.level)}</select>
          <span class="label" id="diffLabel">${t('host.difficulty')}</span>
          <div class="seg" role="radiogroup" aria-labelledby="diffLabel">
            ${DIFFICULTIES.map((d) => `<label class="seg-opt"><input type="radio" name="diff" value="${d}"${d === s.difficulty ? ' checked' : ''} /><span>${escapeHtml(DIFFICULTY_TITLES[d][getLang()])}</span></label>`).join('')}
          </div>
        </div>
```

Replace the `#lv` change listener with:

```ts
  const st = root.querySelector<HTMLSelectElement>('#st')!;
  root.querySelector<HTMLSelectElement>('#lv')!.addEventListener('change', (e) => {
    s.level = (e.target as HTMLSelectElement).value as LevelId;
    s.subtopic = ALL_SUBTOPICS;
    st.innerHTML = subtopicOptions(s.level);
    root.querySelector<HTMLElement>('#subRow')!.hidden = !hasSubtopics(s.level);
  });
  st.addEventListener('change', () => {
    s.subtopic = st.value;
  });
  for (const r of root.querySelectorAll<HTMLInputElement>('input[name=diff]')) {
    r.addEventListener('change', () => {
      if (r.checked) s.difficulty = r.value as Difficulty;
    });
  }
```

In the submit handler replace `s.level = ...` and the `createGame` call/result handling:

```ts
    s.level = root.querySelector<HTMLSelectElement>('#lv')!.value as LevelId;
    const selection: PoolSelection = hasSubtopics(s.level)
      ? { level: s.level, subtopic: s.subtopic, difficulty: s.difficulty }
      : { level: s.level, subtopic: null, difficulty: null };
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = true;
    try {
      const r = await createGame(pw, s.timeLimitMin, selection);
      if (!r.ok) {
        s.error = r.code;
        return renderLogin();
      }
      s.pin = r.pin;
      s.hostToken = r.hostToken;
      s.timeLimitMin = r.timeLimitMin;
      s.game = r.selection;
      s.error = '';
```

- [ ] **Step 5: `hostWelcome` and dashboard header**

In `onMessage` `hostWelcome` replace `s.level = m.level;` with:

```ts
      s.game = { level: m.level, subtopic: m.subtopic, difficulty: m.difficulty };
```

In `renderDash` replace the level line with:

```ts
          <div class="label">${t('host.level')}: <b>${escapeHtml(selectionTitle(s.game))}</b></div>
```

- [ ] **Step 6: CSS** — append to `client/src/ui/styles.css`

```css
.seg { display: flex; gap: 8px; }
.seg-opt { flex: 1; position: relative; }
.seg-opt input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.seg-opt span {
  display: block; padding: 10px 6px; text-align: center; font-weight: 600; border-radius: var(--radius);
  border: 3px solid var(--line); background: var(--panel-2); box-shadow: 0 3px 0 #0008;
}
.seg-opt input:checked + span { background: var(--gold); border-color: var(--gold-d); color: #2a2000; }
.seg-opt input:focus-visible + span { outline: 2px solid var(--gold); outline-offset: 2px; }
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck && npm run build -w client`
Expected: PASS and a successful build.
Manual: `npm run dev -w server` and `npm run dev -w client`, open `/host.html`: Python shows the subtopic row; HTML hides it; switching language keeps choices.

- [ ] **Step 8: Commit**

```bash
git add client/src
git commit -m "feat(host): pick subtopic and difficulty when creating a game

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Smoke, e2e and README

**Files:**
- Modify: `server/scripts/smoke.mjs:56-58`
- Modify: `client/e2e/game.spec.ts` (`hostCreates` + a new picker test)
- Modify: `README.md` ("Edit questions" section)

**Interfaces:**
- Consumes: Task 4 `/api/create` contract; Task 5 DOM ids `#lv`, `#st`, `#subRow`, `input[name=diff]`, `.seg-opt`.

- [ ] **Step 1: Smoke** — replace lines 56–58 of `server/scripts/smoke.mjs`

```js
const bad = await post({ password: PASSWORD, timeLimitMin: 5, level: 'python' });
check(bad.status === 400 && (await bad.json()).error === 'BAD_SELECTION', 'python without subtopic is rejected');
const created = await (await post({ password: PASSWORD, timeLimitMin: 5, level: 'python', subtopic: 'conditions', difficulty: 'hard' })).json();
check(/^\d{6}$/.test(created.pin) && created.hostToken, `game created with PIN ${created.pin}`);
check(created.level === 'python' && created.subtopic === 'conditions' && created.difficulty === 'hard', 'game is created on the requested selection');
```

Run: `npm run dev -w server` (background) then `node server/scripts/smoke.mjs`
Expected: `SMOKE OK`. Also confirm the host `hostWelcome` check in smoke (if any) still passes.

- [ ] **Step 2: e2e `hostCreates`** — in `client/e2e/game.spec.ts`

```ts
async function hostCreates(page: Page): Promise<string> {
  await page.goto('/host.html');
  await page.locator('#pw').fill(PASSWORD);
  await page.locator('#tl').fill('5');
  await page.locator('#lv').selectOption('python');
  await page.locator('#st').selectOption('conditions');
  await page.locator('.seg-opt', { has: page.locator('input[value=hard]') }).click();
  await page.locator('form button[type=submit]').click();
  const pinEl = page.locator('.pin');
  await expect(pinEl).toHaveText(/^\d{6}$/);
  await expect(page.locator('.host-head')).toContainText('Python › Шарттар › Қиын');
  return (await pinEl.textContent())!.trim();
}
```

(The default language is kk — `client/src/i18n/index.ts` `detect()` falls back to `'kk'` — so the Kazakh titles are expected.)

- [ ] **Step 3: e2e picker test** — add to `client/e2e/game.spec.ts`

```ts
test('host picker shows subtopics only for split topics and keeps choices', async ({ page }) => {
  await page.goto('/host.html');
  const row = page.locator('#subRow');
  await page.locator('#lv').selectOption('html');
  await expect(row).toBeHidden();
  await page.locator('#lv').selectOption('python');
  await expect(row).toBeVisible();
  await expect(page.locator('#st option')).toHaveCount(7);
  await page.locator('#st').selectOption('loops');
  await page.locator('.seg-opt', { has: page.locator('input[value=medium]') }).click();

  // Switching topic resets the subtopic but keeps the difficulty.
  await page.locator('#lv').selectOption('html');
  await page.locator('#lv').selectOption('python');
  await expect(page.locator('#st')).toHaveValue('all');
  await expect(page.locator('input[name=diff][value=medium]')).toBeChecked();

  // A language switch (top bar chip «Рус») re-renders the form with the same choices.
  await page.locator('#st').selectOption('loops');
  await page.locator('#topbar .chip', { hasText: 'Рус' }).click();
  await expect(page.locator('label[for=st]')).toHaveText('Раздел');
  await expect(page.locator('#st')).toHaveValue('loops');
  await expect(page.locator('input[name=diff][value=medium]')).toBeChecked();
});
```

- [ ] **Step 4: Run e2e**

Run: `npm run e2e -w client`
Expected: all previous tests plus the new one pass (2 skipped as before).

- [ ] **Step 5: README** — rewrite the "Edit questions" section of `README.md`

```markdown
## Edit questions

Questions are grouped by **level** (one subject module per level). The host picks the level when creating a game.
Some levels (now: Python) are split into **subtopics**, and each of their questions has a **difficulty**
(`easy`, `medium`, `hard`). For those levels the host also picks a subtopic (or "all") and a difficulty.

`server/questions.json` is generated: edit `server/scripts/build_questions.py` and run

    python3 server/scripts/build_questions.py server/questions.json

The generator executes every code snippet and checks the marked answer against the real output.

Rules (checked at server start and by `npm test`):
- a flat level: 10–30 questions;
- a level with subtopics: an object with exactly the subtopic ids from `shared/src/levels.ts`,
  every question tagged with a difficulty, and at least 10 questions per subtopic × difficulty;
- every question: non-empty text, 4 different options, `correct` 0–3, no duplicate text within a level.
```

- [ ] **Step 6: Full verification and commit**

Run: `npm test && npm run typecheck && npm run build -w client`
Expected: all PASS.

```bash
git add server/scripts/smoke.mjs client/e2e/game.spec.ts README.md
git commit -m "test: cover subtopic selection in smoke and e2e; document the question format

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After merge the user redeploys: `npx wrangler deploy` in `server/` (Worker must go first — an old client sends no subtopic and
gets `BAD_SELECTION` for Python, which is the intended loud failure), then Vercel redeploys the site from `main`.
