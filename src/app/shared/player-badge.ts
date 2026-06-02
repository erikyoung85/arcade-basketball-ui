import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Player } from '../core/models/player.model';

/** Circular avatar showing a player's first initial in their accent colour. */
@Component({
  selector: 'app-player-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center justify-center rounded-full font-bold text-white shadow-inner"
      [style.background-color]="player().color"
      [style.width.px]="sizePx()"
      [style.height.px]="sizePx()"
      [style.font-size.px]="sizePx() * 0.42"
    >
      {{ initial() }}
    </span>
  `,
})
export class PlayerBadge {
  readonly player = input.required<Player>();
  /** Diameter in pixels. */
  readonly size = input<number>(48);

  protected readonly sizePx = computed(() => this.size());
  protected readonly initial = computed(
    () => this.player().name.trim().charAt(0).toUpperCase() || '?',
  );
}
