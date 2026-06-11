import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';

import { BackToBackService } from '../../core/services/back-to-back.service';
import { LeaderboardService } from '../../core/services/leaderboard.service';
import { SetupStateService } from '../../core/services/setup-state.service';
import { HoopId } from '../../core/models/game.model';
import { PlayerBadge } from '../../shared/player-badge';

/** Medal emoji for the top three places. */
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Final screen for the turn-based "back to back" modes. Versus shows the winner
 * and each player's strikes; team shows how many rounds the team survived and
 * its placement on the team leaderboard. The game has already been persisted by
 * BackToBackService when it ended.
 */
@Component({
  selector: 'app-back-to-back-results-page',
  imports: [Button, PlayerBadge],
  templateUrl: './back-to-back-results-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackToBackResultsPage {
  private readonly router = inject(Router);
  protected readonly game = inject(BackToBackService);
  private readonly leaderboard = inject(LeaderboardService);
  private readonly setupState = inject(SetupStateService);
  protected readonly result = this.game.result;

  protected readonly hoops: HoopId[] = [1, 2];

  /** Banner text describing the outcome. */
  protected readonly headline = computed(() => {
    const r = this.result();
    if (!r) return '';
    if (r.isTeam) {
      const n = r.roundsSurvived;
      return `Survived ${n} ${n === 1 ? 'round' : 'rounds'}!`;
    }
    return r.winner ? `${r.winner.name} wins!` : 'Game over!';
  });

  /**
   * The team's placement on the team leaderboard (team mode only). Waits for
   * the just-finished game to be written so the new run is counted.
   */
  protected readonly placement = resource({
    params: () => {
      const r = this.result();
      if (!r || !r.isTeam) return undefined;
      return { mode: r.mode.id, rounds: r.roundsSurvived };
    },
    loader: async ({ params }) => {
      await this.game.whenPersisted();
      return this.leaderboard.placementForTeamRounds(params.mode, params.rounds);
    },
  });

  /** Strike pips for a hoop's player (vs) — filled = used. */
  protected strikePips(hoop: HoopId): boolean[] {
    const r = this.result();
    if (!r) return [];
    const used = hoop === 1 ? r.hoop1Strikes : r.hoop2Strikes;
    const max = r.mode.backToBack?.maxStrikes ?? 0;
    return Array.from({ length: max }, (_, i) => i < used);
  }

  /** Strike pips for the shared team count. */
  protected teamStrikePips(): boolean[] {
    const r = this.result();
    if (!r) return [];
    const max = r.mode.backToBack?.maxStrikes ?? 0;
    return Array.from({ length: max }, (_, i) => i < r.teamStrikes);
  }

  protected medal(place: number): string | null {
    return MEDALS[place - 1] ?? null;
  }

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
    void this.router.navigate(['/back-to-back']);
  }

  /** Clear state and go back to the start of the setup wizard. */
  protected newGame(): void {
    this.game.reset();
    this.setupState.step.set(1);
    void this.router.navigate(['/']);
  }
}
