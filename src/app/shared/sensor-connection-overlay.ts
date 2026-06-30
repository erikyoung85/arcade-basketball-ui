import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import { Router } from '@angular/router';

import { PausableGame } from '../core/models/pausable-game';
import { SensorService } from '../core/services/sensor.service';

/**
 * Full-screen overlay shown on an active game screen when the hoop sensors drop.
 * It watches {@link SensorService.status} and the supplied {@link PausableGame}:
 *
 *  - The instant the sensors disconnect mid-game it pauses the game.
 *  - While paused it covers the screen, telling the operator we're reconnecting
 *    automatically and the game will resume where it left off, with an Exit Game
 *    button to abandon the game and return home.
 *  - The instant the sensors reconnect it resumes the game (which replays a
 *    fresh countdown before continuing from the paused point).
 *
 * Exiting only abandons the *game* — it never disconnects the socket, so the
 * app keeps reconnecting in the background regardless.
 */
@Component({
  selector: 'app-sensor-connection-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (game().isAwaitingSensors()) {
      <div
        class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-slate-950/95 px-6 text-center backdrop-blur-sm"
      >
        <i class="pi pi-exclamation-triangle text-7xl text-red-500"></i>
        <div class="flex max-w-md flex-col items-center gap-3">
          <span class="text-3xl font-black uppercase tracking-widest text-red-500">
            Sensors disconnected
          </span>
          <p class="text-base text-slate-300">
            Lost the connection to the hoop sensors. We'll reconnect automatically and the game will
            restart from where it paused.
          </p>
        </div>
        <span class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-amber-400">
          <i class="pi pi-spin pi-spinner"></i>
          Reconnecting…
        </span>
        <button
          type="button"
          (click)="exit()"
          class="flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-sm font-bold uppercase tracking-widest text-orange-300 transition hover:bg-white/20 active:scale-95"
        >
          <i class="pi pi-times"></i>
          Exit Game
        </button>
      </div>
    }
  `,
})
export class SensorConnectionOverlay {
  /** The active game engine to pause/resume in step with the sensor link. */
  readonly game = input.required<PausableGame>();

  private readonly sensor = inject(SensorService);
  private readonly router = inject(Router);

  constructor() {
    // Keep the game in step with the sensor link: pause the moment it drops
    // mid-play, resume the moment it returns. The pause/resume calls are run
    // untracked so they don't feed back into this effect's dependencies.
    effect(() => {
      const connected = this.sensor.status() === 'connected';
      const game = this.game();
      const live = game.isLive();
      const awaiting = game.isAwaitingSensors();
      if (!connected && live) {
        untracked(() => game.pauseForSensorLoss());
      } else if (connected && awaiting) {
        untracked(() => game.resumeAfterSensorLoss());
      }
    });
  }

  /** Abandon the game and return home; the socket keeps reconnecting. */
  protected exit(): void {
    this.game().reset();
    void this.router.navigate(['/']);
  }
}
