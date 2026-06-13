import { ChangeDetectionStrategy, Component, inject, input, resource } from '@angular/core';

import { LeaderboardService } from '../../core/services/leaderboard.service';
import { GameMode } from '../../core/models/game-mode.model';
import { PlayerBadge } from '../../shared/player-badge';

/** Medal emoji for the top three ranks; plain number after that. */
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Shows the top performances for a single game mode, ranked either by points
 * scored (the default) or by how long a player lasted (`metric="duration"`,
 * used by Attrition). Re-fetches whenever the mode or metric changes.
 */
@Component({
  selector: 'app-leaderboard',
  imports: [PlayerBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h2 class="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
        <i class="pi pi-trophy text-orange-400"></i>
        {{ heading() ?? 'Leaderboard — ' + mode().name }}
      </h2>

      @if (entries.isLoading()) {
        <p class="rounded-2xl border-2 border-slate-700 p-5 text-center text-slate-400">
          Loading…
        </p>
      } @else if (entries.error()) {
        <p class="rounded-2xl border-2 border-slate-700 p-5 text-center text-slate-400">
          Couldn't load the leaderboard.
        </p>
      } @else if (!entries.value()?.length) {
        <p class="rounded-2xl border-2 border-dashed border-slate-700 p-5 text-center text-slate-400">
          No scores yet — play a game to make the board.
        </p>
      } @else {
        <ol class="grid gap-3">
          @for (entry of entries.value(); track $index; let i = $index) {
            <li
              class="flex items-center gap-4 rounded-2xl border-2 p-4"
              [class.border-orange-400]="i === 0"
              [class.border-slate-700]="i !== 0"
              [style.background-color]="i === 0 ? 'rgba(251,146,60,0.12)' : 'transparent'"
            >
              <span class="w-10 shrink-0 text-center text-2xl font-black">{{ rank(i) }}</span>
              <app-player-badge [player]="entry.player" [size]="48" />
              <span class="flex-1 truncate text-xl font-bold">{{ entry.player.name }}</span>
              <span class="text-2xl font-black text-orange-400">{{ formatValue(entry.score) }}</span>
            </li>
          }
        </ol>
      }
    </section>
  `,
})
export class Leaderboard {
  private readonly leaderboard = inject(LeaderboardService);

  /** The game mode to rank performances for. */
  readonly mode = input.required<GameMode>();

  /** What to rank by: points scored (default) or seconds lasted. */
  readonly metric = input<'points' | 'duration'>('points');

  /** Optional heading override; defaults to "Leaderboard — {mode name}". */
  readonly heading = input<string>();

  protected readonly entries = resource({
    params: () => ({ mode: this.mode().id, metric: this.metric() }),
    loader: ({ params }) =>
      params.metric === 'duration'
        ? this.leaderboard.topDurations(params.mode, 3)
        : this.leaderboard.topScores(params.mode, 3),
  });

  protected rank(index: number): string {
    return MEDALS[index] ?? `${index + 1}`;
  }

  /** Render a value with a unit suffix for durations (e.g. "26s"). */
  protected formatValue(score: number): string {
    return this.metric() === 'duration' ? `${score}s` : `${score}`;
  }
}
