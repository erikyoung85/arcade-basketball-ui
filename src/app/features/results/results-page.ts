import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';

import { GameService } from '../../core/services/game.service';
import { PlayerBadge } from '../../shared/player-badge';

/**
 * Final screen. Shows each player's score and the winner. The game has already
 * been persisted to Supabase by GameService when the clock hit zero.
 */
@Component({
  selector: 'app-results-page',
  imports: [Button, PlayerBadge],
  templateUrl: './results-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsPage {
  private readonly router = inject(Router);
  protected readonly game = inject(GameService);
  protected readonly result = this.game.result;

  /** Banner text describing the outcome. */
  protected readonly headline = computed(() => {
    const r = this.result();
    if (!r) return '';
    return r.isTie ? "It's a tie!" : `${r.winner?.name} wins!`;
  });

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
    void this.router.navigate(['/game']);
  }

  /** Clear state and go back to player selection. */
  protected newGame(): void {
    this.game.reset();
    void this.router.navigate(['/']);
  }
}
