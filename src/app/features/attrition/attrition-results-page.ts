import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';

import { AttritionService } from '../../core/services/attrition.service';
import { LeaderboardService } from '../../core/services/leaderboard.service';
import { SetupStateService } from '../../core/services/setup-state.service';
import { PlayerBadge } from '../../shared/player-badge';

/** Medal emoji for the top three places — matches the home-page leaderboard. */
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Final screen for the "Attrition" mode. Shows each player's locked-in score
 * and the winner. The game has already been persisted to Supabase by
 * AttritionService when the last clock hit zero. Mirrors the standard results
 * page — Attrition ranks each player by points, just like a timed score.
 */
@Component({
  selector: 'app-attrition-results-page',
  imports: [Button, PlayerBadge],
  templateUrl: './attrition-results-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttritionResultsPage {
  private readonly router = inject(Router);
  protected readonly game = inject(AttritionService);
  private readonly leaderboard = inject(LeaderboardService);
  private readonly setupState = inject(SetupStateService);
  protected readonly result = this.game.result;

  /** Banner text describing the outcome. */
  protected readonly headline = computed(() => {
    const r = this.result();
    if (!r) return '';
    if (r.isSinglePlayer) {
      const player = r.hoop1Player ?? r.hoop2Player;
      return `${player?.name} made the board!`;
    }
    return r.isTie ? "It's a tie!" : `${r.winner?.name} wins!`;
  });

  /**
   * Each playing hoop's placement on the mode's leaderboard, keyed by hoop.
   * Waits for the just-finished game to be written before reading, so the new
   * scores are counted. A null entry means that hoop had no player (or Supabase
   * isn't configured). Both solo and head-to-head games are handled — each
   * player is ranked the same way.
   */
  protected readonly placements = resource({
    params: () => {
      const r = this.result();
      if (!r) return undefined;
      return {
        mode: r.mode.id,
        hoop1: r.hoop1Player ? r.hoop1Score : null,
        hoop2: r.hoop2Player ? r.hoop2Score : null,
      };
    },
    loader: async ({ params }) => {
      await this.game.whenPersisted();
      const [hoop1, hoop2] = await Promise.all([
        params.hoop1 === null
          ? Promise.resolve(null)
          : this.leaderboard.placementForScore(params.mode, params.hoop1),
        params.hoop2 === null
          ? Promise.resolve(null)
          : this.leaderboard.placementForScore(params.mode, params.hoop2),
      ]);
      return { hoop1, hoop2 };
    },
  });

  /** The resolved placement for a hoop, or null while loading / not ranked. */
  protected placementFor(hoop: 1 | 2): number | null {
    const p = this.placements.value();
    if (!p) return null;
    return hoop === 1 ? p.hoop1 : p.hoop2;
  }

  /** Medal emoji for a top-three placement, otherwise null. */
  protected medal(place: number): string | null {
    return MEDALS[place - 1] ?? null;
  }

  /** Ordinal label for a placement, e.g. 1 → "1st", 12 → "12th". */
  protected ordinal(place: number): string {
    const mod100 = place % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
    switch (place % 10) {
      case 1:
        return `${place}st`;
      case 2:
        return `${place}nd`;
      case 3:
        return `${place}rd`;
      default:
        return `${place}th`;
    }
  }

  constructor() {
    if (!this.game.result()) {
      void this.router.navigate(['/']);
    }
  }

  /** Replay the same matchup and mode. */
  protected playAgain(): void {
    const r = this.result();
    if (!r) return;
    this.game.configure({
      mode: r.mode,
      hoop1Player: r.hoop1Player,
      hoop2Player: r.hoop2Player,
    });
    void this.router.navigate(['/attrition']);
  }

  /** Clear state and go back to the start of the setup wizard. */
  protected newGame(): void {
    this.game.reset();
    this.setupState.step.set(1);
    void this.router.navigate(['/']);
  }
}
