import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.client';
import { GameModeId } from '../models/game-mode.model';
import { LeaderboardEntry, TeamLeaderboardEntry } from '../models/leaderboard.model';
import { Player } from '../models/player.model';

/** The mode id whose games feed the team leaderboard. */
const TEAM_MODE: GameModeId = 'back-to-back-team';

/** Shape of an embedded player row returned alongside a game. */
interface EmbeddedPlayer {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

/** A `games` row with both players embedded via their foreign keys. */
interface GameWithPlayers {
  created_at: string;
  hoop1_score: number;
  hoop2_score: number;
  hoop1_player: EmbeddedPlayer | null;
  hoop2_player: EmbeddedPlayer | null;
}

/**
 * Reads high scores for the leaderboard.
 *
 * Each game stores two scoring performances (one per hoop), so a game is
 * flattened into two candidate entries before ranking.
 */
@Injectable({ providedIn: 'root' })
export class LeaderboardService {
  private readonly supabase = inject(SupabaseService);

  /**
   * The top scoring performances for a game mode, highest first.
   * Returns an empty list when Supabase is not configured.
   */
  async topScores(mode: GameModeId, limit = 3): Promise<LeaderboardEntry[]> {
    const client = this.supabase.client;
    if (!client) {
      return [];
    }

    const { data, error } = await client
      .from('games')
      .select(
        `created_at,
         hoop1_score,
         hoop2_score,
         hoop1_player:players!games_hoop1_player_id_fkey (id, name, color, created_at),
         hoop2_player:players!games_hoop2_player_id_fkey (id, name, color, created_at)`,
      )
      .eq('mode', mode);

    if (error) {
      throw new Error(error.message);
    }

    const entries: LeaderboardEntry[] = [];
    for (const game of (data ?? []) as unknown as GameWithPlayers[]) {
      if (game.hoop1_player) {
        entries.push(toEntry(game.hoop1_player, game.hoop1_score, game.created_at));
      }
      if (game.hoop2_player) {
        entries.push(toEntry(game.hoop2_player, game.hoop2_score, game.created_at));
      }
    }

    // Highest score first; older performances win ties (they got there first).
    entries.sort(
      (a, b) => b.score - a.score || a.playedAt.localeCompare(b.playedAt),
    );
    return entries.slice(0, limit);
  }

  /**
   * The 1-based placement a score earns on a mode's leaderboard (1 = top).
   * Ranking matches {@link topScores}: every recorded hoop performance counts,
   * and ties are broken by recency, so a freshly-played score sits below any
   * equal earlier one.
   *
   * Assumes the score being ranked has *already been persisted* — its own row
   * is counted, which is what makes the arithmetic land on the right place.
   * Returns null when Supabase is not configured.
   */
  async placementForScore(mode: GameModeId, score: number): Promise<number | null> {
    const client = this.supabase.client;
    if (!client) {
      return null;
    }

    const { data, error } = await client
      .from('games')
      .select('hoop1_score, hoop2_score, hoop1_player_id, hoop2_player_id')
      .eq('mode', mode);

    if (error) {
      throw new Error(error.message);
    }

    // Count every performance that ranks at or above this score. With the
    // score's own row included (and newest among equals → last in a tie),
    // that count *is* its placement.
    let placement = 0;
    for (const game of data ?? []) {
      if (game.hoop1_player_id && game.hoop1_score >= score) placement++;
      if (game.hoop2_player_id && game.hoop2_score >= score) placement++;
    }
    return placement;
  }

  /**
   * How many games in a mode a player has completed, counting either hoop.
   * Used on the player-selection step to show each player's experience in the
   * chosen mode. Returns 0 when Supabase is not configured.
   */
  async gamesPlayed(mode: GameModeId, playerId: string): Promise<number> {
    const client = this.supabase.client;
    if (!client) {
      return 0;
    }

    const { count, error } = await client
      .from('games')
      .select('*', { count: 'exact', head: true })
      .eq('mode', mode)
      .or(`hoop1_player_id.eq.${playerId},hoop2_player_id.eq.${playerId}`);

    if (error) {
      throw new Error(error.message);
    }

    return count ?? 0;
  }

  /**
   * Top team performances for the "back to back team" mode, ranked by rounds
   * survived (highest first; older runs win ties). Each game is one team entry —
   * the duo (or lone solo player) — rather than two per-hoop performances.
   * Rounds survived is stored in the score columns by the game service.
   * Returns an empty list when Supabase is not configured.
   */
  async topTeamScores(limit = 3): Promise<TeamLeaderboardEntry[]> {
    const client = this.supabase.client;
    if (!client) {
      return [];
    }

    const { data, error } = await client
      .from('games')
      .select(
        `created_at,
         hoop1_score,
         hoop1_player:players!games_hoop1_player_id_fkey (id, name, color, created_at),
         hoop2_player:players!games_hoop2_player_id_fkey (id, name, color, created_at)`,
      )
      .eq('mode', TEAM_MODE);

    if (error) {
      throw new Error(error.message);
    }

    const entries: TeamLeaderboardEntry[] = [];
    for (const game of (data ?? []) as unknown as TeamGameRow[]) {
      const players = [game.hoop1_player, game.hoop2_player]
        .filter((p): p is EmbeddedPlayer => !!p)
        .map(toPlayer);
      if (!players.length) continue;
      entries.push({ players, roundsSurvived: game.hoop1_score, playedAt: game.created_at });
    }

    entries.sort(
      (a, b) => b.roundsSurvived - a.roundsSurvived || a.playedAt.localeCompare(b.playedAt),
    );
    return entries.slice(0, limit);
  }

  /**
   * The 1-based placement a team's rounds-survived earns on the team
   * leaderboard (1 = top). Assumes the run has already been persisted, so its
   * own row is counted. Returns null when Supabase is not configured.
   */
  async placementForTeamRounds(roundsSurvived: number): Promise<number | null> {
    const client = this.supabase.client;
    if (!client) {
      return null;
    }

    const { data, error } = await client
      .from('games')
      .select('hoop1_score, hoop1_player_id')
      .eq('mode', TEAM_MODE);

    if (error) {
      throw new Error(error.message);
    }

    let placement = 0;
    for (const game of data ?? []) {
      if (game.hoop1_player_id && game.hoop1_score >= roundsSurvived) placement++;
    }
    return placement;
  }
}

/** A team `games` row with both players embedded; score holds rounds survived. */
interface TeamGameRow {
  created_at: string;
  hoop1_score: number;
  hoop1_player: EmbeddedPlayer | null;
  hoop2_player: EmbeddedPlayer | null;
}

function toPlayer(row: EmbeddedPlayer): Player {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.created_at };
}

function toEntry(row: EmbeddedPlayer, score: number, playedAt: string): LeaderboardEntry {
  return { player: toPlayer(row), score, playedAt };
}
