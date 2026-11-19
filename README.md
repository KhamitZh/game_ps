# Кілт үйі — Key House — Дом ключей

Kahoot-style 2D multiplayer game for practical lessons: students join with a PIN, explore a two-floor house,
answer one question per room and collect keys. Ranking: keys first, then the time of the last key.

## Run locally

```bash
npm install
cp server/.dev.vars.example server/.dev.vars   # HOST_PASSWORD=dev-password
npm run dev -w server     # Worker on http://localhost:8787
npm run dev -w client     # Site on http://localhost:5173
```

- Host panel: http://localhost:5173/host.html (password from `server/.dev.vars`)
- Players: http://localhost:5173/ — phones on the same Wi-Fi can use `http://<your-LAN-IP>:5173/`

## Tests

```bash
npm test                         # unit tests (shared, server, client)
npm run typecheck
npm run smoke -w server          # protocol smoke test (needs the dev server running)
cd client && npx playwright test # browser e2e (starts both dev servers)
```

## Edit questions

Questions are grouped by **level** (one subject module per level). The host picks the level when creating a game.
Level ids, subtopics and their titles in three languages live in `shared/src/levels.ts`:
`numsys`, `database`, `excel`, `python`, `html`, `css`, `js`, `computer`, `networks`, `grade11`.

Some levels (now: Python) are split into **subtopics**, and each of their questions has a **difficulty**
(`easy`, `medium`, `hard`). For those levels the host also picks a subtopic (or "all subtopics") and a difficulty.

`server/questions.json` is generated — edit `server/scripts/build_questions.py` and run

```bash
python3 server/scripts/build_questions.py server/questions.json
```

The generator executes every code snippet and checks the marked answer against the real output.
Rules (checked at server start and by `npm test`):
- a flat level: **10–30** questions `{ "q": "...", "options": ["A", "B", "C", "D"], "correct": 0 }`;
- a level with subtopics: an object with exactly the subtopic ids from `shared/src/levels.ts`, every question
  tagged with `"difficulty"`, and at least **10** questions per subtopic × difficulty;
- every question: non-empty text, 4 different options, `correct` 0–3, no duplicate text within a level.

Each player gets a different question from the game's pool in every one of the 10 rooms, with shuffled options.
With a single subtopic (10 questions per difficulty) every player gets the same set in a different order — the host
panel says so; pick "all subtopics" for different questions.
Use `\n` in `q` for multi-line code: the first line is the prompt, the rest is shown as a monospace code block.
A player has 60 s per question (`QUESTION_TIME_MS` in `shared/src/constants.ts`), counted from the first opening;
after that the room counts as answered wrong.

**Translations.** A question may carry `"i18n": { "ru": { "q": "...", "options": [...] }, "en": {...} }` with the
options in the same order. Players see their language and fall back to Kazakh. Python questions are fully translated
(`TR`, `STEM_TR`, `OUTPUT_TR` in the generator, which refuses an untranslated Python question); the other levels
are Kazakh only for now — add entries to `TR` to translate them.

Run `npm test` to validate, then redeploy the server.

## Deploy

1. **Cloudflare (server)** — free account:
   ```bash
   cd server
   npx wrangler login
   npx wrangler secret put HOST_PASSWORD
   npx wrangler deploy            # prints https://key-house.<you>.workers.dev
   ```
2. **Vercel (site)** — push the repo to GitHub, import it in Vercel, set **Root Directory** = `client`,
   framework = Vite, and add the environment variable `VITE_SERVER_URL=https://key-house.<you>.workers.dev`.
3. Lock CORS: `ALLOWED_ORIGIN` in `server/wrangler.toml` is the production site
   (`https://game-ps.vercel.app`; several origins can be separated by commas). Change it if your Vercel URL differs,
   then redeploy. Local dev overrides it with `ALLOWED_ORIGIN=*` from `server/.dev.vars`.

Game creation (the host password) is limited to 10 attempts per IP per minute (`[[ratelimits]]` in
`server/wrangler.toml`). Use a long host password anyway.

Host page in production: `https://<your-site>.vercel.app/host`.
