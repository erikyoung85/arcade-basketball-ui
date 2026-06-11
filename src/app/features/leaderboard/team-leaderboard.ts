import { ChangeDetectionStrategy, Component, inject, input, resource } from '@angular/core';

import { LeaderboardService } from '../../core/services/leaderboard.service';
import { GameModeId } from '../../core/models/game-mode.model';
import { PlayerBadge } from '../../shared/player-badge';

/** Medal emoji for the top three ranks; plain number after that. */
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Shows the top teams for a rounds-survived "back to back" mode (Team or Solo),
 * ranked by how many rounds the duo (or lone solo player) survived. The mode and
 * heading are inputs so the same board serves both the Team and Solo formats.
 */
@Component({
  selector: 'app-team-leaderboard',
  imports: [PlayerBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h2 class="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
        <i class="pi pi-trophy text-orange-400"></i>
        Leaderboard — {{ heading() }}
      </h2>

      @if (entries.isLoading()) {
        <p class="rounded-2xl border-2 border-slate-700 p-5 text-center text-slate-400">
          Loading top teams…
        </p>
      } @else if (entries.error()) {
        <p class="rounded-2xl border-2 border-slate-700 p-5 text-center text-slate-400">
          Couldn't load the leaderboard.
        </p>
      } @else if (!entries.value()?.length) {
        <p class="rounded-2xl border-2 border-dashed border-slate-700 p-5 text-center text-slate-400">
          No teams yet — play a game to make the board.
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
              <div class="flex shrink-0 -space-x-2">
                @for (player of entry.players; track player.id) {
                  <app-player-badge [player]="player" [size]="48" />
                }
              </div>
              <span class="flex-1 truncate text-xl font-bold">{{ names(entry.players) }}</span>
              <span class="text-right">
                <span class="block text-2xl font-black text-orange-400">{{ entry.roundsSurvived }}</span>
                <span class="text-xs uppercase tracking-widest text-slate-400">
                  {{ entry.roundsSurvived === 1 ? 'round' : 'rounds' }}
                </span>
              </span>
            </li>
          }
        </ol>
      }
    </section>
  `,
})
export class TeamLeaderboard {
  private readonly leaderboard = inject(LeaderboardService);

  /** Which rounds-survived board to show. */
  readonly mode = input<GameModeId>('back-to-back-team');
  /** Heading shown after "Leaderboard — ". */
  readonly heading = input('Back to Back Team');

  protected readonly entries = resource({
    params: () => ({ mode: this.mode() }),
    loader: ({ params }) => this.leaderboard.topTeamScores(params.mode, 3),
  });

  protected rank(index: number): string {
    return MEDALS[index] ?? `${index + 1}`;
  }

  protected names(players: { name: string }[]): string {
    return players.map((p) => p.name).join(' & ');
  }
}
