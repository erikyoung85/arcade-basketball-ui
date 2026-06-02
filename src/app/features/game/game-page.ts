import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { GameService } from '../../core/services/game.service';
import { HoopId } from '../../core/models/game.model';
import { PlayerBadge } from '../../shared/player-badge';
import { MqttStatusIndicator } from '../../shared/mqtt-status-indicator';

/**
 * Active game screen. Drives the pre-game countdown then the game clock via
 * GameService. Scores are driven by the basketball hoop sensors over MQTT
 * (see GameService/MqttService); each hoop panel just displays its live score,
 * with a small undo button to correct the occasional false sensor read. When
 * the game finishes the user is routed to the results page.
 */
@Component({
  selector: 'app-game-page',
  imports: [PlayerBadge, MqttStatusIndicator],
  templateUrl: './game-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GamePage {
  private readonly router = inject(Router);
  protected readonly game = inject(GameService);

  constructor() {
    // No setup means the user deep-linked here — send them back to start.
    if (!this.game.setup()) {
      void this.router.navigate(['/']);
      return;
    }

    this.game.startCountdown();

    // When the clock hits zero the game finishes; move to the results screen.
    effect(() => {
      if (this.game.status() === 'finished') {
        void this.router.navigate(['/results']);
      }
    });
  }

  protected undoShot(hoop: HoopId): void {
    this.game.undoShot(hoop);
  }
}
