import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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

  constructor() {
    document.addEventListener(
      'click',
      () => {
        this.soundService.initSpeechSynthesis();
      },
      { once: true },
    );
  }
}
