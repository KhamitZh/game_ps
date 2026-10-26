# Бөлімдер және қиындық деңгейі — дизайн

Күні: 2026-10-27 · Тармақ: `feat/subtopics-difficulty`

## Мақсат

Мұғалім (админ) жаңа ойын ашқанда тек тақырыпты емес, тақырып ішіндегі **бөлімді** (мысалы Python → Шарттар)
және **қиындық деңгейін** (Жеңіл / Орташа / Қиын) таңдай алсын. Мақсат — оқушыларды ҰБТ информатикасына
нақты бөлім бойынша, біртіндеп күрделенетін сұрақтармен дайындау.

## Шешімдер (бекітілген)

- Қиындық — сұрақтың өз қасиеті: әр сұрақ `easy | medium | hard` белгісін алады.
  Уақыт пен ұпай өзгермейді.
- Пилот: тек **Python** толық жасалады (6 бөлім × 3 қиындық × 10 сұрақ = 180 сұрақ). Қалған 9 тақырып
  кейін 2–3-тен толтырылады. Оған дейін олар бұрынғыдай (бөлімсіз, қиындықсыз) ойналады.
- «Аралас» қиындық нұсқасы **жоқ**.
- Бөлім тізімінде «Барлық бөлімдер» (`all`) нұсқасы бар.

## Python бөлімдері

| id | kk | ru | en | Мазмұны |
|---|---|---|---|---|
| `basics` | Айнымалылар және амалдар | Переменные и операции | Variables and operators | типтер, `input/print`, `//`, `%`, `**`, түрлендіру |
| `conditions` | Шарттар | Условия | Conditions | `if/elif/else`, салыстыру, `and/or/not`, кірістірілген шарттар |
| `loops` | Циклдар | Циклы | Loops | `for`, `range`, `while`, `break/continue`, трассировка |
| `strings` | Жолдар | Строки | Strings | индекс, кесінді, `len`, `upper`, `count`, `replace` |
| `lists` | Тізімдер (массивтер) | Списки (массивы) | Lists (arrays) | 1D/2D, `append`, `sort`, іздеу |
| `functions` | Функциялар | Функции | Functions | `def`, `return`, параметрлер, әдепкі мән |

## 1. Деректер пішімі

`server/questions.json` — тақырып кілті екі пішімнің бірін алады:

```jsonc
{
  "html": [ { "q": "...", "options": ["a","b","c","d"], "correct": 1 } ],   // ескі: тізім
  "python": {                                                                 // жаңа: бөлімдер
    "conditions": [
      { "q": "...", "options": ["a","b","c","d"], "correct": 2, "difficulty": "easy" }
    ],
    "loops": [ ... ]
  }
}
```

`shared/src/levels.ts` (клиент пен серверге ортақ, жауаптар жоқ):

```ts
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const DEFAULT_DIFFICULTY: Difficulty = 'easy';
export const ALL_SUBTOPICS = 'all';
/** Бөлім id-лері мен атаулары бір жерде; объект кілттерінің реті = UI-дағы рет. */
export const SUBTOPICS: Partial<Record<LevelId, Record<string, Record<Lang, string>>>> = {
  python: { basics: {...}, conditions: {...}, loops: {...}, strings: {...}, lists: {...}, functions: {...} },
};
export const DIFFICULTY_TITLES: Record<Difficulty, Record<Lang, string>>;
export function subtopicIds(level: LevelId): string[];
export function hasSubtopics(level: LevelId): boolean;
export function isSubtopic(level: LevelId, v: unknown): v is string; // `all` те жарамды
export function isDifficulty(v: unknown): v is Difficulty;
export function resolveSelection(level: LevelId, subtopic: unknown, difficulty: unknown): PoolSelection | null;
```

Таңдау түрі:

```ts
export interface PoolSelection {
  level: LevelId;
  subtopic: string | null;      // бөлімі жоқ тақырыпта null
  difficulty: Difficulty | null; // бөлімі жоқ тақырыпта null
}
```

## 2. Валидатор (`validateQuestions`)

- `SUBTOPICS`-та бар тақырып (python) **міндетті түрде** бөлімдер нысаны болуы керек; онда:
  - тек `subtopicIds(level)` ішіндегі кілттер (белгісіз бөлім → қате; жетіспейтін бөлім → қате);
  - әр сұрақта `difficulty` ∈ `DIFFICULTIES` (әйтпесе қате);
  - әр бөлім × қиындық жұбында ≥ `MIN_LEVEL_QUESTIONS` (10) сұрақ;
  - бір тақырып ішінде (барлық бөлімдер бойынша) сұрақ мәтіні қайталанбайды;
  - тақырып бойынша жалпы 30-сұрақ шегі бөлімді тақырыпқа қолданылмайды.
- Бөлімі жоқ тақырыптар — бұрынғы ережелер (тізім, 10..30).
- Ортақ сұрақ тексерулері (`q`, 4 әртүрлі опция, `correct` 0..3) өзгеріссіз.

Валидатор нәтижесі — қалыпты түр: `QuestionBank = Record<LevelId, Question[] | Record<string, Question[]>>`,
`Question` ішінде `difficulty?: Difficulty`.

## 3. Жиынтықты таңдау (`selectPool`)

`server/src/questions.ts`:

```ts
export function selectPool(bank: QuestionBank, sel: PoolSelection): Question[]
```

- Бөлімі жоқ тақырып → тақырыптың тізімі.
- `subtopic === 'all'` → `subtopicIds(level)` ретімен бөлімдерді біріктіріп, `difficulty` бойынша сүзу.
- Нақты бөлім → сол бөлімді `difficulty` бойынша сүзу.
- Бөлімді тақырыпта `subtopic === null` болса (жаңартуға дейін сақталған ойын) → барлық бөлімнің барлық
  сұрағы. `answer` сақталған `qIndex` жиынтықтан тыс болса `NO_QUESTION` қайтарады, құламайды.
- Ретті ешқашан араластырмайды (`filter`/`concat` ғана) — сақталған `qIndex` Durable Object қайта
  іске қосылғаннан кейін де дұрыс сұраққа сілтейді.

## 4. Сервер

- `POST /api/create` денесі: `{ password, timeLimitMin, level, subtopic?, difficulty? }`.
  - `level` бұрынғыдай (жарамсыз → `DEFAULT_LEVEL`).
  - `hasSubtopics(level)` болса: `subtopic` (`isSubtopic`) және `difficulty` (`isDifficulty`) міндетті,
    жарамсыз/жоқ → `400 { error: 'BAD_SELECTION' }` (`resolveSelection` → `null`). Үнсіз әдепкі мәнге ауыспайды.
    Тексеру құпия сөз тексерілгеннен кейін жасалады.
  - Бөлімі жоқ тақырыпта екеуі де `null` болып сақталады (жіберілгені ескерілмейді).
  - Жауап: `{ pin, hostToken, timeLimitMin, level, subtopic, difficulty }`.
- `GameRoom.init` таңдауды алып, `Game`-ге береді.
- `Game` конструкторы bank орнына `selection: PoolSelection` және дайын `pool: Question[]` алады;
  `interact`/`answer` осы `pool`-ды қолданады.
- `GameData`-ға `subtopic`, `difficulty` қосылады; `fromData` ескі жазбаларда `null` алады;
  `GameRoom` жүктегенде pool-ды `selectPool(bank, selection)` арқылы қайта есептейді.

## 5. Хаттама

- `hostWelcome`: `subtopic: string | null`, `difficulty: Difficulty | null` қосылады.
- Ойыншыға баратын хабарлар өзгермейді.

## 6. Админ беті (`client/src/host/main.ts`)

```
Тақырып:   [ 4. Python            ▾ ]
Бөлім:     [ Барлық бөлімдер      ▾ ]   ← тақырып ауысқанда қайта толады
Қиындық:   ( Жеңіл ) ( Орташа ) ( Қиын )   ← radio-батырмалар, әдепкі «Жеңіл»
Уақыт:     [ 10 мин ]
           [ Ойын бастау ]
```

- `hasSubtopics(level)` жалған болса, «Бөлім» мен «Қиындық» жолдары `hidden`.
- Бөлім тізімі: бірінші «Барлық бөлімдер», сосын `subtopicIds(level)` ретімен; әдепкі — «Барлық бөлімдер».
- Қиындық: `<input type="radio" name="diff">`, CSS арқылы батырма түрінде.
- Таңдау `localStorage`-та сақталмайды.
- Панель тақырыбы: `Python › Шарттар › Қиын` (бөлімі жоқ тақырыпта тек тақырып атауы).
- i18n (kk/ru/en): `host.subtopic`, `host.difficulty`, `host.allSubtopics`; бөлім/қиындық атаулары
  `shared`-тағы `*_TITLES`-тан алынады.

## 7. Сұрақтар (180)

- Генератор репоға көшіріледі: `server/scripts/build_questions.py` (келесі тақырыптар үшін де керек); код сұрақтарының жауабы Python-да орындалып тексеріледі,
  есептеу сұрақтары есептеліп тексеріледі.
- Қиындық критерийлері:
  - **Жеңіл** — бір ұғым, 1–3 жол код (мыс. `7 // 2`).
  - **Орташа** — 2–3 ұғым немесе 4–6 жол код (мыс. `elif`, циклдағы жинақтау).
  - **Қиын** — кірістірілген құрылымдар, трассировка, шекаралық жағдайлар
    (мыс. `for…else` + `break`, теріс қадамды кесінді, тізімнің өзгермелілігі).
- Бұрынғы 24 Python сұрағы белгіленіп, бөлімдерге бөлінеді; қайталанғаны алынады.
- Әр бөлім × қиындық — дәл 10 сұрақ (кейін көбейтуге болады).

## 8. Тесттер

- **Unit (Vitest):**
  - `selectPool`: бөлім, `all`, қиындық бойынша сүзу; рет сақталуы; бөлімсіз тақырып.
  - `validateQuestions`: ≥10 ережесі, белгісіз/жетіспейтін бөлім, белгісіз `difficulty`,
    бөлімдер ішіндегі қайталау, ескі пішім өзгеріссіз.
  - Worker `createGame`: жарамсыз/жоқ `subtopic` немесе `difficulty` → 400; бөлімсіз тақырыпта `null`.
  - `Game`: таңдау `toData`/`fromData` арқылы сақталады; ескі деректерде `null`.
  - Нақты `questions.json`: Python-ның әр бөлім × қиындық жұбында ≥10.
- **Smoke:** `python / conditions / hard` ойыны жасалып, жауапта сол мәндер қайтады.
- **E2E (Playwright):** Python таңдағанда бөлім/қиындық өрістері көрінеді, HTML-де жасырылады;
  ойын жасалған соң панельде «Python › Шарттар › Қиын».

## Ауқымнан тыс

- Қалған 9 тақырыптың бөлімдері мен сұрақтары (келесі кезеңдер).
- «Аралас» қиындық, таңдауды есте сақтау, қиындыққа қарай уақыт/ұпай өзгерту.
