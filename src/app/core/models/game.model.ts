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

/**
 * Lifecycle of a locally-managed game.
 *
 * `preparing` is a brief, pre-countdown state while the game's audio assets are
 * downloaded, so a slow connection can't delay sounds once play begins.
 * `paused` is entered when the hoop sensors drop mid-game: the clock freezes
 * until they reconnect, then a fresh countdown resumes play.
 */
export type GameStatus =
  | 'idle'
  | 'preparing'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'finished';

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
   * How long each player was actually shooting, in seconds. Only set for modes
   * where players can finish at different times (Attrition, where each runs an
   * independent clock); undefined for shared-clock modes. A null/undefined hoop
   * means that hoop had no player.
   */
  hoop1DurationSeconds?: number;
  hoop2DurationSeconds?: number;
  /**
   * Winning player. Null on a tie, and always null for a single-player game
   * (there is no opponent to beat — see {@link isSinglePlayer}).
   */
  winner: Player | null;
  isTie: boolean;
  /** True when only one hoop had a player; the game was a solo run. */
  isSinglePlayer: boolean;
}
