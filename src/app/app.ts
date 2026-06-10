import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { MqttService } from './core/services/mqtt.service';
import { SoundService } from './core/services/sound.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly soundService = inject(SoundService);
  private readonly mqtt = inject(MqttService);
  private readonly router = inject(Router);

  constructor() {
    // Keep the broker link up app-wide so the sensor's mode is always tracked,
    // no matter which screen the operator happens to be on.
    this.mqtt.connect();

    document.addEventListener(
      'click',
      () => {
        this.soundService.initSpeechSynthesis();
      },
      { once: true },
    );

    // Mirror the sensor's mode in the route: drop into the test page when it
    // enters debug mode, and return to the main page when it goes back to
    // production. `router.url` is read live (it isn't a signal) so this only
    // re-runs on a mode change, never on the navigations it triggers.
    effect(() => {
      const mode = this.mqtt.mode();
      const onTestPage = this.router.url.startsWith('/test');
      if (mode === 'debug' && !onTestPage) {
        void this.router.navigate(['/test']);
      } else if (mode === 'production' && onTestPage) {
        void this.router.navigate(['/']);
      }
    });
  }
}
