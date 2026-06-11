import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';

import { PlayerService } from '../../core/services/player.service';
import { GameService } from '../../core/services/game.service';
import { BackToBackService } from '../../core/services/back-to-back.service';
import { MqttService } from '../../core/services/mqtt.service';
import { LeaderboardService } from '../../core/services/leaderboard.service';
import { SetupStateService } from '../../core/services/setup-state.service';
import {
  GAME_MODE_GROUPS,
  GameMode,
  GameModeGroup,
  isBackToBack,
} from '../../core/models/game-mode.model';
import { HoopId } from '../../core/models/game.model';
import { Player } from '../../core/models/player.model';
import { PlayerBadge } from '../../shared/player-badge';
import { MqttStatusIndicator } from '../../shared/mqtt-status-indicator';
import { Leaderboard } from '../leaderboard/leaderboard';
import { TeamLeaderboard } from '../leaderboard/team-leaderboard';

/**
 * Landing page, run as a two-step setup wizard:
 *
 *  1. Choose a game mode. Modes are grouped (Standard, Clutch Time, Back to
 *     Back); a group with multiple variants (Back to Back → VS / Team) reveals
 *     sub-options once selected. The leaderboard for the chosen mode shows here.
 *  2. Choose the player(s) and start. Each chosen player shows how many games
 *     they've completed in this mode, and the 1-/2-player rule is enforced.
 *
 * Designed for touch: large tap targets, no required typing except when
 * creating a brand-new player.
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
  private readonly leaderboardService = inject(LeaderboardService);
  private readonly setupState = inject(SetupStateService);

  protected readonly groups = GAME_MODE_GROUPS;

  // Backed by SetupStateService (root-provided) so the operator's choices —
  // and which wizard step they're on — persist after navigating away and
  // returning here, until a full page refresh.
  protected readonly step = this.setupState.step;
  protected readonly groupId = this.setupState.groupId;
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

  /** The currently selected mode group. */
  protected readonly selectedGroup = computed<GameModeGroup>(
    () => this.groups.find((g) => g.id === this.groupId()) ?? this.groups[0],
  );

  /** True when the selected group needs a sub-option chosen (e.g. Back to Back). */
  protected readonly needsVariant = computed(() => this.selectedGroup().variants.length > 1);

  /** True when the selected mode is the head-to-head "back to back vs" mode. */
  protected readonly isVersusMode = computed(() => {
    const mode = this.selectedMode();
    return !!mode?.backToBack && !mode.backToBack.team;
  });

  /** True when the selected mode is single-player only (one player, either basket). */
  protected readonly isSoloMode = computed(() => !!this.selectedMode()?.requiresSoloPlayer);

  /** True when the selected mode is the co-operative "back to back team" mode (not solo). */
  protected readonly isTeamMode = computed(
    () => !!this.selectedMode()?.backToBack?.team && !this.isSoloMode(),
  );

  /** Whether the selected mode must be started with both hoops filled. */
  protected readonly requiresTwoPlayers = computed(
    () => !!this.selectedMode()?.requiresTwoPlayers,
  );

  /** A mode is fully chosen (a variant has been picked where required). */
  protected readonly canContinue = computed(() => !!this.selectedMode());

  /**
   * Enough players are chosen to start. Solo needs exactly one player; Versus
   * needs both hoops filled; every other mode allows one or two.
   */
  protected readonly playersReady = computed(() => {
    const h1 = !!this.hoop1Player();
    const h2 = !!this.hoop2Player();
    if (this.isSoloMode()) return h1 !== h2;
    if (this.requiresTwoPlayers()) return h1 && h2;
    return (h1 && h2) || h1 || h2;
  });

  /** The hoop sensors are reachable over MQTT. */
  protected readonly sensorsReady = computed(() => this.mqtt.status() === 'connected');

  /** A game may only start with valid players chosen and sensors connected. */
  protected readonly canStart = computed(() => this.playersReady() && this.sensorsReady());

  /** Games each chosen player has completed in the selected mode. */
  protected readonly hoop1Games = resource({
    params: () => this.gamesParams(this.hoop1Player()),
    loader: ({ params }) => this.leaderboardService.gamesPlayed(params.mode, params.playerId),
  });
  protected readonly hoop2Games = resource({
    params: () => this.gamesParams(this.hoop2Player()),
    loader: ({ params }) => this.leaderboardService.gamesPlayed(params.mode, params.playerId),
  });

  private gamesParams(player: Player | null): { mode: GameMode['id']; playerId: string } | undefined {
    const mode = this.selectedMode();
    return mode && player ? { mode: mode.id, playerId: player.id } : undefined;
  }

  /** The resolved games-played count for a hoop, or undefined while loading. */
  protected gamesPlayedFor(hoop: HoopId): number | undefined {
    return hoop === 1 ? this.hoop1Games.value() : this.hoop2Games.value();
  }

  // --- Step 1: mode selection ------------------------------------------------

  protected selectGroup(group: GameModeGroup): void {
    if (this.groupId() === group.id) return;
    this.groupId.set(group.id);
    // Single-variant groups resolve immediately; multi-variant groups (Back to
    // Back) require the operator to pick a sub-option, so clear the mode first.
    this.selectedMode.set(group.variants.length === 1 ? group.variants[0].mode : null);
  }

  protected selectVariant(mode: GameMode): void {
    this.selectedMode.set(mode);
    // Solo is a single-player run — drop any second-hoop selection so we don't
    // carry a stray player into a one-basket game.
    if (mode.requiresSoloPlayer) this.hoop2Player.set(null);
  }

  protected goToPlayers(): void {
    if (this.canContinue()) this.step.set(2);
  }

  protected backToModes(): void {
    this.step.set(1);
  }

  // --- Step 2: player selection ----------------------------------------------

  protected openPicker(hoop: HoopId): void {
    this.addingPlayer.set(false);
    this.newPlayerName.set('');
    this.pickerHoop.set(hoop);
  }

  protected closePicker(): void {
    this.pickerHoop.set(null);
  }

  /**
   * A player already chosen on the *other* hoop, to disable in the picker. In a
   * single-player mode nothing is disabled — choosing a basket moves the lone
   * player there (clearing the other hoop), so the same player must stay pickable.
   */
  protected disabledPlayerId(): string | null {
    if (this.isSoloMode()) return null;
    const hoop = this.pickerHoop();
    if (hoop === 1) return this.hoop2Player()?.id ?? null;
    if (hoop === 2) return this.hoop1Player()?.id ?? null;
    return null;
  }

  protected selectPlayer(player: Player): void {
    const solo = this.isSoloMode();
    if (this.pickerHoop() === 1) {
      this.hoop1Player.set(player);
      // Single-player modes hold one player total — picking a basket moves them.
      if (solo) this.hoop2Player.set(null);
    } else if (this.pickerHoop() === 2) {
      this.hoop2Player.set(player);
      if (solo) this.hoop1Player.set(null);
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
    if (!mode || !this.playersReady() || !this.sensorsReady()) return;

    // Turn-based "back to back" modes run on their own engine + screens.
    if (isBackToBack(mode)) {
      this.backToBack.configure({ mode, hoop1Player, hoop2Player });
      void this.router.navigate(['/back-to-back']);
      return;
    }

    this.game.configure({ mode, hoop1Player, hoop2Player });
    void this.router.navigate(['/game']);
  }

  /** Put the sensor into debug mode and open the test screen. */
  protected openTestMode(): void {
    this.mqtt.enterDebugMode();
    void this.router.navigate(['/test']);
  }
}
