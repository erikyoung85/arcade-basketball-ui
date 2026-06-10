import { Player } from './player.model';

/** A single high-score performance shown on the leaderboard. */
export interface LeaderboardEntry {
  /** The player who put up the score. */
  player: Player;
  /** Points scored in that game. */
  score: number;
  /** When the game was played (ISO timestamp), used to break ties. */
  playedAt: string;
}

/**
 * A team's performance on the "back to back team" leaderboard, ranked by how
 * many rounds the duo (or lone solo player) survived.
 */
export interface TeamLeaderboardEntry {
  /** The team — two players, or one for a solo run. */
  players: Player[];
  /** Rounds the team survived before the run ended. */
  roundsSurvived: number;
  /** When the game was played (ISO timestamp), used to break ties. */
  playedAt: string;
}
