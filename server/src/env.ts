import type { GameRoom } from './GameRoom';

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  HOST_PASSWORD: string;
  ALLOWED_ORIGIN: string;
}
