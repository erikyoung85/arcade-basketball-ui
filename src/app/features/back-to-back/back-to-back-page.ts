import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { BackToBackService } from '../../core/services/back-to-back.service';
import { SoundService } from '../../core/services/sound.service';
import { HoopId } from '../../core/models/game.model';
import { PlayerBadge } from '../../shared/player-badge';
import { SensorConnectionOverlay } from '../../shared/sensor-connection-overlay';
import { SensorStatusIndicator } from '../../shared/sensor-status-indicator';

/**
 * Active screen for the turn-based "back to back" modes. Players take turns
 * shooting against a per-turn shot clock; the BackToBackService drives the
 * whole round/turn sequence and this component just renders it. On finish the
 * user is routed to the back-to-back results page.
 */
@Component({
  selector: 'app-back-to-back-page',
  imports: [PlayerBadge, SensorStatusIndicator, SensorConnectionOverlay],
  templateUrl: './back-to-back-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackToBackPage {
  private readonly router = inject(Router);
  protected readonly game = inject(BackToBackService);
  private readonly sound = inject(SoundService);

  protected readonly hoops: HoopId[] = [1, 2];

  constructor() {
    // No setup means the user deep-linked here — send them back to start.
    if (!this.game.setup()) {
      void this.router.navigate(['/']);
      return;
    }

    // Download the game's sounds first so audio isn't delayed mid-game, showing
    // a "Preparing…" screen meanwhile, then kick off the pre-game countdown.
    let left = false;
    this.game.markPreparing();
    void this.sound.preload().then(() => {
      if (!left) this.game.startCountdown();
    });

    // Route to results once the game ends.
    effect(() => {
      if (this.game.status() === 'finished') {
        this.sound.stopAll();
        void this.router.navigate(['/back-to-back/results']);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      left = true;
      this.sound.stopAll();
    });
  }

  /** Strike pips for a hoop's player (vs) — filled = used. */
  protected strikePips(hoop: HoopId): boolean[] {
    return this.pips(this.game.strikesForHoop(hoop));
  }

  /** Strike pips for the shared team count. */
  protected teamStrikePips(): boolean[] {
    return this.pips(this.game.teamStrikes());
  }

  private pips(used: number): boolean[] {
    return Array.from({ length: this.game.maxStrikes() }, (_, i) => i < used);
  }
}
