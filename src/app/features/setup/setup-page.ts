import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';

import { PlayerService } from '../../core/services/player.service';
import { GameService } from '../../core/services/game.service';
import { DEFAULT_GAME_MODE, GAME_MODES, GameMode } from '../../core/models/game-mode.model';
import { HoopId } from '../../core/models/game.model';
import { Player } from '../../core/models/player.model';
import { PlayerBadge } from '../../shared/player-badge';

/**
 * Landing page. The operator picks a player for each hoop and a game mode,
 * then starts the game. Designed for touch: large tap targets, no required
 * typing except when creating a brand-new player.
 */
@Component({
  selector: 'app-setup-page',
  imports: [FormsModule, Button, Dialog, InputText, PlayerBadge],
  templateUrl: './setup-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupPage {
  private readonly router = inject(Router);
  protected readonly playerService = inject(PlayerService);
  private readonly game = inject(GameService);

  protected readonly modes = GAME_MODES;
  protected readonly selectedMode = signal<GameMode>(DEFAULT_GAME_MODE);

  protected readonly hoop1Player = signal<Player | null>(null);
  protected readonly hoop2Player = signal<Player | null>(null);

  /** Which hoop the picker dialog is choosing for (null = closed). */
  protected readonly pickerHoop = signal<HoopId | null>(null);
  protected readonly addingPlayer = signal(false);
  protected readonly newPlayerName = signal('');
  protected readonly savingPlayer = signal(false);

  protected readonly canStart = computed(
    () => !!this.hoop1Player() && !!this.hoop2Player(),
  );

  protected openPicker(hoop: HoopId): void {
    this.addingPlayer.set(false);
    this.newPlayerName.set('');
    this.pickerHoop.set(hoop);
  }

  protected closePicker(): void {
    this.pickerHoop.set(null);
  }

  /** A player already chosen on the *other* hoop, to disable in the picker. */
  protected disabledPlayerId(): string | null {
    const hoop = this.pickerHoop();
    if (hoop === 1) return this.hoop2Player()?.id ?? null;
    if (hoop === 2) return this.hoop1Player()?.id ?? null;
    return null;
  }

  protected selectPlayer(player: Player): void {
    if (this.pickerHoop() === 1) {
      this.hoop1Player.set(player);
    } else if (this.pickerHoop() === 2) {
      this.hoop2Player.set(player);
    }
    this.closePicker();
  }

  protected async addPlayer(): Promise<void> {
    const name = this.newPlayerName().trim();
    if (!name || this.savingPlayer()) return;

    this.savingPlayer.set(true);
    try {
      const player = await this.playerService.addPlayer(name);
      this.selectPlayer(player);
    } catch (err) {
      console.error(err);
    } finally {
      this.savingPlayer.set(false);
      this.addingPlayer.set(false);
      this.newPlayerName.set('');
    }
  }

  protected startGame(): void {
    const hoop1Player = this.hoop1Player();
    const hoop2Player = this.hoop2Player();
    if (!hoop1Player || !hoop2Player) return;

    this.game.configure({ mode: this.selectedMode(), hoop1Player, hoop2Player });
    void this.router.navigate(['/game']);
  }
}
