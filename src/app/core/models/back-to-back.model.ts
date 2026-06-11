import { GameMode } from './game-mode.model';
import { HoopId } from './game.model';
import { Player } from './player.model';

/**
 * Lifecycle of a turn-based "back to back" game.
 *
 * `preparing` is a brief, pre-countdown state while the game's audio assets are
 * downloaded; `playing` covers the whole sequence of rounds and turns.
 */
export type BackToBackStatus = 'idle' | 'preparing' | 'countdown' | 'playing' | 'finished';

/** How a single player's turn resolved. */
export type ShotOutcome = 'made' | 'missed';

/**
 * Which part of a turn is on screen: `ready` is the brief "you're up" beat
 * before the clock starts, `shooting` is the live shot window, and `result`
 * shows whether the shot was made or missed.
 */
export type TurnPhase = 'ready' | 'shooting' | 'result';

/** Outcome of a completed round, shown briefly before the next round begins. */
export interface RoundOutcome {
  /** Whether a strike was handed out this round. */
  struck: boolean;
  /** The player who took the strike (vs mode), or null (team mode / no strike). */
  struckPlayer: Player | null;
  /** Short message describing the round, e.g. "Strike on Alice" or "Clean round". */
  message: string;
}

/** The final outcome of a back-to-back game. */
export interface BackToBackResult {
  mode: GameMode;
  hoop1Player: Player | null;
  hoop2Player: Player | null;
  /** Strikes the hoop-1 player finished with (vs mode). */
  hoop1Strikes: number;
  /** Strikes the hoop-2 player finished with (vs mode). */
  hoop2Strikes: number;
  /** Shared strikes the team finished with (team mode). */
  teamStrikes: number;
  /** Rounds completed and survived before the game ended (team mode ranking). */
  roundsSurvived: number;
  /** Winning player in vs mode; null in team mode. */
  winner: Player | null;
  /** Losing player in vs mode; null in team mode. */
  loser: Player | null;
  /** True for the co-operative team mode, false for head-to-head vs. */
  isTeam: boolean;
  /** True for the single-player solo run (its own leaderboard). */
  isSolo: boolean;
  /** True when only one hoop had a player (solo, or a team run played alone). */
  isSinglePlayer: boolean;
}

/** The hoops, in turn order, that have a player in this game. */
export function mannedHoops(
  hoop1Player: Player | null,
  hoop2Player: Player | null,
): HoopId[] {
  const hoops: HoopId[] = [];
  if (hoop1Player) hoops.push(1);
  if (hoop2Player) hoops.push(2);
  return hoops;
}
