import { DEFAULT_TIME_LIMIT_MIN, MAX_TIME_LIMIT_MIN, MIN_TIME_LIMIT_MIN } from '../../shared/src/constants';
import { DEFAULT_LEVEL, isLevelId } from '../../shared/src/levels';
import type { Env } from './env';
import { GameRoom } from './GameRoom';

export { GameRoom };

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

function json(env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(env) },
  });
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function randomPin(): string {
  return String((crypto.getRandomValues(new Uint32Array(1))[0] % 900_000) + 100_000);
}

function room(env: Env, pin: string) {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(pin));
}

async function createGame(req: Request, env: Env): Promise<Response> {
  let body: { password?: unknown; timeLimitMin?: unknown; level?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(env, { error: 'BAD_REQUEST' }, 400);
  }
  if (!env.HOST_PASSWORD || typeof body.password !== 'string' || !safeEqual(body.password, env.HOST_PASSWORD)) {
    return json(env, { error: 'BAD_PASSWORD' }, 403);
  }
  const requested = Number(body.timeLimitMin);
  const timeLimitMin = Number.isFinite(requested)
    ? Math.min(MAX_TIME_LIMIT_MIN, Math.max(MIN_TIME_LIMIT_MIN, Math.round(requested)))
    : DEFAULT_TIME_LIMIT_MIN;
  const level = isLevelId(body.level) ? body.level : DEFAULT_LEVEL;
  const hostToken = crypto.randomUUID();
  for (let attempt = 0; attempt < 10; attempt++) {
    const pin = randomPin();
    if (await room(env, pin).init({ pin, timeLimitMin, level, hostToken })) {
      return json(env, { pin, hostToken, timeLimitMin, level });
    }
  }
  return json(env, { error: 'BUSY' }, 503);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (url.pathname === '/') return new Response('Key House server OK', { headers: corsHeaders(env) });
    if (url.pathname === '/api/create' && req.method === 'POST') return createGame(req, env);

    const info = url.pathname.match(/^\/api\/game\/(\d{6})$/);
    if (info && req.method === 'GET') return json(env, await room(env, info[1]).info());

    const ws = url.pathname.match(/^\/ws\/(\d{6})$/);
    if (ws) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return room(env, ws[1]).fetch(req);
    }
    return new Response('Not found', { status: 404, headers: corsHeaders(env) });
  },
} satisfies ExportedHandler<Env>;
