import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';

import { MqttService } from '../../core/services/mqtt.service';
import { SoundService } from '../../core/services/sound.service';
import { DebugShotEvent } from '../../core/models/debug-shot-event.model';
import { MqttStatusIndicator } from '../../shared/mqtt-status-indicator';

/** A received debug-shot event, tagged with an id so the list can track it. */
interface DebugShotRow extends DebugShotEvent {
  id: number;
}

/**
 * Sensor test (debug) mode screen. Reached automatically when the sensor
 * reports `debug` mode, or manually from setup. While here, the sensor streams
 * per-shot diagnostics on `basketball/debug/shots`; each event is shown with its
 * full (multi-line) log and announced as a made/missed shot. Leaving via "Back
 * to Main" asks the sensor to return to production mode.
 */
@Component({
  selector: 'app-test-page',
  imports: [Button, MqttStatusIndicator],
  templateUrl: './test-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestPage {
  private readonly router = inject(Router);
  protected readonly mqtt = inject(MqttService);
  private readonly sound = inject(SoundService);

  /** Received shot events, newest first. */
  protected readonly shots = signal<DebugShotRow[]>([]);
  private nextId = 0;

  constructor() {
    this.mqtt.debugShots$.pipe(takeUntilDestroyed()).subscribe((event) => {
      this.shots.update((rows) => [{ ...event, id: this.nextId++ }, ...rows]);
      if (event.isShotMade) this.sound.playShotMade();
      else this.sound.playShotMissed();
    });

    inject(DestroyRef).onDestroy(() => this.sound.stopAll());
  }

  /** Leave test mode: ask the sensor back to production and return home. */
  protected exitTestMode(): void {
    this.mqtt.enterProductionMode();
    void this.router.navigate(['/']);
  }

  protected clearLog(): void {
    this.shots.set([]);
  }
}
