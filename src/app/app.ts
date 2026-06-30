import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SensorService } from './core/services/sensor.service';
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
  private readonly sensor = inject(SensorService);
  private readonly router = inject(Router);

  constructor() {
    // Open the sensor link once, here, for the whole browser session. App is
    // the root component and never torn down, so this single connection stays
    // up across every screen and game — services only subscribe to its shots,
    // they never open or close the socket. SensorService auto-reconnects on its
    // own if the link ever drops.
    this.sensor.connect();

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
      const mode = this.sensor.mode();
      const onTestPage = this.router.url.startsWith('/test');
      if (mode === 'debug' && !onTestPage) {
        void this.router.navigate(['/test']);
      } else if (mode === 'production' && onTestPage) {
        void this.router.navigate(['/']);
      }
    });
  }
}
