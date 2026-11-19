import type { GameRoom } from './GameRoom';

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  HOST_PASSWORD: string;
  /** "*", one origin, or several separated by commas. */
  ALLOWED_ORIGIN: string;
  /** Limits game creation (password guesses) per IP; optional so older local setups still run. */
  CREATE_LIMITER?: RateLimit;
}
