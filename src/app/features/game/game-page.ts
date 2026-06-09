import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { Router } from '@angular/router';

import { GameService } from '../../core/services/game.service';
import { SoundService } from '../../core/services/sound.service';
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
          void this.router.navigate(['/results']);
          break;
      }
    });

    // Speak the "10 seconds left" warning once, when the clock reaches 0:10.
    // Guarded so it fires a single time even as the signal ticks down.
    let warned = false;
    effect(() => {
      if (this.game.status() === 'running' && this.game.secondsRemaining() === 10 && !warned) {
        warned = true;
        this.sound.playTenSecondWarning();
      }
    });

    // Announce "Clutch Time" once, the moment a clutch mode enters its final
    // higher-scoring window.
    let clutchAnnounced = false;
    effect(() => {
      if (this.game.isClutchActive() && !clutchAnnounced) {
        clutchAnnounced = true;
        this.sound.playClutchTime();
      }
    });

    // Announce the final "3 · 2 · 1" countdown, each number once.
    const counted = new Set<number>();
    effect(() => {
      const n = this.game.secondsRemaining();
      if (this.game.status() === 'running' && n <= 3 && n >= 1 && !counted.has(n)) {
        counted.add(n);
        this.sound.playEndCountdown(n);
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
