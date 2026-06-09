import { GameMode } from './game-mode.model';
import { Player } from './player.model';

/** Which physical hoop a shot/score belongs to. */
export type HoopId = 1 | 2;

/**
 * The choices made on the setup screen before a game starts.
 *
 * Each hoop's player is independent and may be null. Selecting a player for
 * only one hoop is a valid "single player" game, where that lone player just
 * competes for a spot on the leaderboard; the unmanned hoop is ignored. At
 * least one of the two must be set for a game to start.
 */
export interface GameSetup {
  mode: GameMode;
  hoop1Player: Player | null;
  hoop2Player: Player | null;
}

/** Lifecycle of a locally-managed game. */
export type GameStatus = 'idle' | 'countdown' | 'running' | 'finished';

/** The final outcome, computed when the timer reaches zero. */
export interface GameResult {
  mode: GameMode;
  hoop1Player: Player | null;
  hoop2Player: Player | null;
  hoop1Shots: number;
  hoop2Shots: number;
  hoop1Score: number;
  hoop2Score: number;
  /**
   * Winning player. Null on a tie, and always null for a single-player game
   * (there is no opponent to beat — see {@link isSinglePlayer}).
   */
  winner: Player | null;
  isTie: boolean;
  /** True when only one hoop had a player; the game was a solo run. */
  isSinglePlayer: boolean;
}
