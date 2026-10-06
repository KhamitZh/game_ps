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

Edit `server/questions.json`: every room id (`f1r1`…`f1r5`, `f2r1`…`f2r5`) needs at least one question
`{ "q": "...", "options": ["A", "B", "C", "D"], "correct": 0 }` (`correct` is the index 0–3). Each player gets a
random question from the room's list with shuffled options. Run `npm test` to validate, then redeploy the server.

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
3. Optionally lock CORS: set `ALLOWED_ORIGIN` in `server/wrangler.toml` to your Vercel URL and redeploy.

Host page in production: `https://<your-site>.vercel.app/host`.
