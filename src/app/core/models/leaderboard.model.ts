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
