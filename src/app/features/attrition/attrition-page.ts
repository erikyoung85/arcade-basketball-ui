import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AttritionService } from '../../core/services/attrition.service';
import { SoundService } from '../../core/services/sound.service';
import { HoopId } from '../../core/models/game.model';
import { PlayerBadge } from '../../shared/player-badge';
import { MqttStatusIndicator } from '../../shared/mqtt-status-indicator';

/**
 * Active screen for the "Attrition" mode. Each hoop panel shows its player's
 * own countdown clock, score and basket count, driven by the hoop sensors over
 * MQTT (see AttritionService/MqttService). A player whose clock hits zero is
 * marked "Out" but the other plays on; when both clocks empty the user is
 * routed to the results page.
 */
@Component({
  selector: 'app-attrition-page',
  imports: [PlayerBadge, MqttStatusIndicator],
  templateUrl: './attrition-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttritionPage {
  private readonly router = inject(Router);
  protected readonly game = inject(AttritionService);
  private readonly sound = inject(SoundService);

  constructor() {
    // No setup means the user deep-linked here — send them back to start.
    if (!this.game.setup()) {
      void this.router.navigate(['/']);
      return;
    }

    // Download all the game's sounds first so a slow connection can't delay
    // audio mid-game, showing a "Preparing…" screen meanwhile. Once they're
    // buffered, kick off the normal 3·2·1 countdown. Guarded against the
    // operator navigating away before the download finishes.
    let left = false;
    this.game.markPreparing();
    void this.sound.preload().then(() => {
      if (!left) this.game.startCountdown();
    });

    // Drive audio off the game status. Reads only status(), so this runs once
    // per transition: countdown sound on the 3·2·1, music while playing.
    effect(() => {
      switch (this.game.status()) {
        case 'countdown':
          this.sound.playCountdown();
          break;
        case 'running':
          this.sound.startBackgroundMusic();
          break;
        case 'finished':
          this.sound.stopAll();
          void this.router.navigate(['/attrition/results']);
          break;
      }
    });

    // Sound the alarm once when a player's clock empties (they're knocked out).
    const eliminated = new Set<HoopId>();
    effect(() => {
      if (this.game.status() !== 'running') return;
      for (const hoop of [1, 2] as const) {
        const out = hoop === 1 ? !this.game.hoop1Active() : !this.game.hoop2Active();
        const manned = hoop === 1 ? !!this.game.setup()?.hoop1Player : !!this.game.setup()?.hoop2Player;
        if (manned && out && !eliminated.has(hoop)) {
          eliminated.add(hoop);
          this.sound.playStrike();
        }
      }
    });

    // Stop any audio if the user navigates away mid-game, and don't start the
    // countdown if a still-pending preload resolves after we've left.
    inject(DestroyRef).onDestroy(() => {
      left = true;
      this.sound.stopAll();
    });
  }

  protected undoShot(hoop: HoopId): void {
    this.game.undoShot(hoop);
  }
}
