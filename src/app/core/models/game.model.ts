import { GameMode } from './game-mode.model';
import { Player } from './player.model';

/** Which physical hoop a shot/score belongs to. */
export type HoopId = 1 | 2;

/** The choices made on the setup screen before a game starts. */
export interface GameSetup {
  mode: GameMode;
  hoop1Player: Player;
  hoop2Player: Player;
}

/** Lifecycle of a locally-managed game. */
export type GameStatus = 'idle' | 'countdown' | 'running' | 'finished';

/** The final outcome, computed when the timer reaches zero. */
export interface GameResult {
  mode: GameMode;
  hoop1Player: Player;
  hoop2Player: Player;
  hoop1Shots: number;
  hoop2Shots: number;
  hoop1Score: number;
  hoop2Score: number;
  /** Winning player, or null on a tie. */
  winner: Player | null;
  isTie: boolean;
}
