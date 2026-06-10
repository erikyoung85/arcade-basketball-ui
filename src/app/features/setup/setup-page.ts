import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';

import { PlayerService } from '../../core/services/player.service';
import { GameService } from '../../core/services/game.service';
import { BackToBackService } from '../../core/services/back-to-back.service';
import { MqttService } from '../../core/services/mqtt.service';
import { SetupStateService } from '../../core/services/setup-state.service';
import { GAME_MODES, isBackToBack } from '../../core/models/game-mode.model';
import { HoopId } from '../../core/models/game.model';
import { Player } from '../../core/models/player.model';
import { PlayerBadge } from '../../shared/player-badge';
import { MqttStatusIndicator } from '../../shared/mqtt-status-indicator';
import { Leaderboard } from '../leaderboard/leaderboard';
import { TeamLeaderboard } from '../leaderboard/team-leaderboard';

/**
 * Landing page. The operator picks a player for each hoop and a game mode,
 * then starts the game. Designed for touch: large tap targets, no required
 * typing except when creating a brand-new player.
 */
@Component({
  selector: 'app-setup-page',
  imports: [
    FormsModule,
    Button,
    Dialog,
    InputText,
    PlayerBadge,
    MqttStatusIndicator,
    Leaderboard,
    TeamLeaderboard,
  ],
  templateUrl: './setup-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupPage {
  private readonly router = inject(Router);
  protected readonly playerService = inject(PlayerService);
  private readonly game = inject(GameService);
  private readonly backToBack = inject(BackToBackService);
  protected readonly mqtt = inject(MqttService);
  private readonly setupState = inject(SetupStateService);

  protected readonly modes = GAME_MODES;

  // Backed by SetupStateService (root-provided) so the operator's choices
  // persist after playing a game and returning here, until a full page refresh.
  protected readonly selectedMode = this.setupState.mode;
  protected readonly hoop1Player = this.setupState.hoop1Player;
  protected readonly hoop2Player = this.setupState.hoop2Player;

  constructor() {
    // Establish the broker link up front so the operator can see sensor
    // status here and can't start a game until the hoops are connected.
    this.mqtt.connect();
  }

  /** Which hoop the picker dialog is choosing for (null = closed). */
  protected readonly pickerHoop = signal<HoopId | null>(null);
  protected readonly addingPlayer = signal(false);
  protected readonly newPlayerName = signal('');
  protected readonly savingPlayer = signal(false);

  /** True when the selected mode is the head-to-head "back to back vs" mode. */
  protected readonly isVersusMode = computed(
    () => !!this.selectedMode().backToBack && !this.selectedMode().backToBack!.team,
  );

  /** True when the selected mode is the co-operative "back to back team" mode. */
  protected readonly isTeamMode = computed(() => !!this.selectedMode().backToBack?.team);

  /** Whether the selected mode must be started with both hoops filled. */
  protected readonly requiresTwoPlayers = computed(() => !!this.selectedMode().requiresTwoPlayers);

  /**
   * Enough players are chosen to start. Versus needs both hoops filled; every
   * other mode allows a single player (a solo run / solo team).
   */
  protected readonly playersReady = computed(() => {
    const both = !!this.hoop1Player() && !!this.hoop2Player();
    if (this.requiresTwoPlayers()) return both;
    return both || !!this.hoop1Player() || !!this.hoop2Player();
  });

  /** The hoop sensors are reachable over MQTT. */
  protected readonly sensorsReady = computed(() => this.mqtt.status() === 'connected');

  /** A game may only start with both players chosen and sensors connected. */
  protected readonly canStart = computed(() => this.playersReady() && this.sensorsReady());

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

  /** Empty the hoop the picker is open for, e.g. to drop down to a solo game. */
  protected clearCurrentHoop(): void {
    if (this.pickerHoop() === 1) {
      this.hoop1Player.set(null);
    } else if (this.pickerHoop() === 2) {
      this.hoop2Player.set(null);
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
    const mode = this.selectedMode();
    if (!this.playersReady() || !this.sensorsReady()) return;

    // Turn-based "back to back" modes run on their own engine + screens.
    if (isBackToBack(mode)) {
      this.backToBack.configure({ mode, hoop1Player, hoop2Player });
      void this.router.navigate(['/back-to-back']);
      return;
    }

    this.game.configure({ mode, hoop1Player, hoop2Player });
    void this.router.navigate(['/game']);
  }
}
