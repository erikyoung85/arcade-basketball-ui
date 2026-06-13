import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { SupabaseService } from '../supabase/supabase.client';
import { MqttService } from './mqtt.service';
import { GameResult, GameSetup, GameStatus, HoopId } from '../models/game.model';

/** Length of the pre-game "3 · 2 · 1 · GO" countdown, in seconds. */
const COUNTDOWN_SECONDS = 3;
/** Clock tick interval. Small enough for smooth progress rings. */
const TICK_MS = 100;

/**
 * Owns the state of a single "Attrition" game. Unlike a standard game there is
 * no shared clock: each player runs their own countdown. A made shot banks
 * points (worth more when that player's clock is low) and adds time to *that
 * player's* clock. When a player's clock empties they're done — their score is
 * locked and further shots on their hoop are ignored — while the other player
 * keeps shooting until their own clock runs out. The game ends once both
 * (manned) clocks reach zero, and only then is the result written to Supabase.
 *
 * Provided in root so state survives navigation between the setup, game and
 * results routes. Mirrors {@link GameService} in shape and lifecycle.
 */
@Injectable({ providedIn: 'root' })
export class AttritionService {
  private readonly supabase = inject(SupabaseService);
  private readonly mqtt = inject(MqttService);

  private readonly _setup = signal<GameSetup | null>(null);
  private readonly _status = signal<GameStatus>('idle');
  // The point value of each made shot, captured at the moment it was scored —
  // a shot can be worth 2 or 3 depending on the player's remaining clock, so we
  // can't multiply a count by a flat value after the fact.
  private readonly _hoop1ShotPoints = signal<number[]>([]);
  private readonly _hoop2ShotPoints = signal<number[]>([]);
  private readonly _countdownValue = signal(COUNTDOWN_SECONDS);
  // Each player's independent clock, in milliseconds.
  private readonly _hoop1TimeMs = signal(0);
  private readonly _hoop2TimeMs = signal(0);
  // How long each player has actually been shooting, in milliseconds — the time
  // their clock was running. Accumulated each tick while the clock is above
  // zero, so it captures the bonus seconds banked from made shots (and undos).
  private readonly _hoop1ElapsedMs = signal(0);
  private readonly _hoop2ElapsedMs = signal(0);
  private readonly _result = signal<GameResult | null>(null);

  /** Public read-only views of state. */
  readonly setup = this._setup.asReadonly();
  readonly status = this._status.asReadonly();
  readonly countdownValue = this._countdownValue.asReadonly();
  readonly hoop1TimeMs = this._hoop1TimeMs.asReadonly();
  readonly hoop2TimeMs = this._hoop2TimeMs.asReadonly();
  readonly result = this._result.asReadonly();

  readonly hoop1Shots = computed(() => this._hoop1ShotPoints().length);
  readonly hoop2Shots = computed(() => this._hoop2ShotPoints().length);

  readonly hoop1Score = computed(() => this._hoop1ShotPoints().reduce((sum, p) => sum + p, 0));
  readonly hoop2Score = computed(() => this._hoop2ShotPoints().reduce((sum, p) => sum + p, 0));

  /** Whole seconds left on each player's clock (rounded up for display). */
  readonly hoop1SecondsRemaining = computed(() => Math.ceil(this._hoop1TimeMs() / 1000));
  readonly hoop2SecondsRemaining = computed(() => Math.ceil(this._hoop2TimeMs() / 1000));

  /**
   * 0–1 fill for each player's clock bar. Capped at the starting value so the
   * bar reads full once a player has banked time beyond their initial clock.
   */
  readonly hoop1Progress = computed(() => this.clockFill(this._hoop1TimeMs()));
  readonly hoop2Progress = computed(() => this.clockFill(this._hoop2TimeMs()));

  /**
   * True when only one hoop has a player — a solo run for the leaderboard
   * rather than a head-to-head. Shots on the unmanned hoop are ignored.
   */
  readonly isSinglePlayer = computed(() => {
    const setup = this._setup();
    if (!setup) return false;
    return !setup.hoop1Player !== !setup.hoop2Player;
  });

  /** True while a player can still shoot: game running, manned, clock above zero. */
  readonly hoop1Active = computed(() => this.isActive(1));
  readonly hoop2Active = computed(() => this.isActive(2));

  /** True while a player's clock is in the higher-scoring "danger" window. */
  readonly hoop1LowTime = computed(() => this.isLowTime(1));
  readonly hoop2LowTime = computed(() => this.isLowTime(2));

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private shotSub: Subscription | null = null;

  // Resolves once the most recent finished game has been written to Supabase
  // (or the attempt has settled). The results page awaits this before reading
  // the leaderboard, so the just-played score is counted in the placement.
  private persistPromise: Promise<void> = Promise.resolve();

  /** Store the setup chosen on the landing page. */
  configure(setup: GameSetup): void {
    this.clearTimer();
    this._setup.set(setup);
    this._hoop1ShotPoints.set([]);
    this._hoop2ShotPoints.set([]);
    this._result.set(null);
    this._status.set('idle');
    this.resetClocks(setup);
    this._hoop1ElapsedMs.set(0);
    this._hoop2ElapsedMs.set(0);
    this._countdownValue.set(COUNTDOWN_SECONDS);
  }

  /**
   * Enter the brief "preparing" state shown while the game's audio assets are
   * downloaded. startCountdown() takes over once they're ready.
   */
  markPreparing(): void {
    if (!this._setup() || this._status() !== 'idle') return;
    this._status.set('preparing');
  }

  /** Run the pre-game countdown, then start the clocks. */
  startCountdown(): void {
    if (!this._setup() || (this._status() !== 'idle' && this._status() !== 'preparing')) return;
    this._status.set('countdown');
    this._countdownValue.set(COUNTDOWN_SECONDS);

    // Open the broker link now so it's ready by the time play begins. Shots
    // are ignored until the status is 'running' (see recordShot).
    this.startListeningForShots();

    this.clearTimer();
    this.intervalId = setInterval(() => {
      const next = this._countdownValue() - 1;
      if (next <= 0) {
        this.clearTimer();
        this.beginPlay();
      } else {
        this._countdownValue.set(next);
      }
    }, 1000);
  }

  /**
   * Record a made shot on the given hoop. Driven by `basketball/shots` events
   * from the MQTT broker (see startListeningForShots). Ignored unless the game
   * is running and that player still has time on their clock; otherwise it
   * banks points (2, or 3 while the clock is low) and extends that clock.
   */
  recordShot(hoop: HoopId): void {
    if (this._status() !== 'running') return;
    if (!this.isActive(hoop)) return;

    const attrition = this._setup()!.mode.attrition!;
    const points = this.isLowTime(hoop) ? attrition.lowTimePoints : this._setup()!.mode.pointsPerShot;
    const bonusMs = attrition.secondsPerShot * 1000;

    if (hoop === 1) {
      this._hoop1ShotPoints.update((p) => [...p, points]);
      this._hoop1TimeMs.update((t) => t + bonusMs);
    } else {
      this._hoop2ShotPoints.update((p) => [...p, points]);
      this._hoop2TimeMs.update((t) => t + bonusMs);
    }
  }

  /**
   * Undo the most recent made shot on a hoop (corrects a false sensor read).
   * Reverses the time the phantom basket added too, but never drops the clock
   * to zero — an undo shouldn't eliminate a still-playing player.
   */
  undoShot(hoop: HoopId): void {
    if (this._status() !== 'running' || !this.isActive(hoop)) return;
    const bonusMs = this._setup()!.mode.attrition!.secondsPerShot * 1000;
    if (hoop === 1) {
      if (!this._hoop1ShotPoints().length) return;
      this._hoop1ShotPoints.update((p) => p.slice(0, -1));
      this._hoop1TimeMs.update((t) => Math.max(TICK_MS, t - bonusMs));
    } else {
      if (!this._hoop2ShotPoints().length) return;
      this._hoop2ShotPoints.update((p) => p.slice(0, -1));
      this._hoop2TimeMs.update((t) => Math.max(TICK_MS, t - bonusMs));
    }
  }

  /** Reset everything back to idle (e.g. when leaving the game). */
  reset(): void {
    this.clearTimer();
    this.stopListeningForShots();
    this._setup.set(null);
    this._status.set('idle');
    this._hoop1ShotPoints.set([]);
    this._hoop2ShotPoints.set([]);
    this._result.set(null);
    this._hoop1TimeMs.set(0);
    this._hoop2TimeMs.set(0);
    this._hoop1ElapsedMs.set(0);
    this._hoop2ElapsedMs.set(0);
    this._countdownValue.set(COUNTDOWN_SECONDS);
  }

  private beginPlay(): void {
    const setup = this._setup();
    if (!setup) return;

    this._status.set('running');
    this.resetClocks(setup);
    this._hoop1ElapsedMs.set(0);
    this._hoop2ElapsedMs.set(0);

    this.clearTimer();
    this.intervalId = setInterval(() => {
      // Tick down each manned, still-running clock independently, counting the
      // elapsed time so we know how long each player actually shot for.
      if (this._hoop1TimeMs() > 0) {
        this._hoop1ElapsedMs.update((e) => e + TICK_MS);
        this._hoop1TimeMs.set(Math.max(0, this._hoop1TimeMs() - TICK_MS));
      }
      if (this._hoop2TimeMs() > 0) {
        this._hoop2ElapsedMs.update((e) => e + TICK_MS);
        this._hoop2TimeMs.set(Math.max(0, this._hoop2TimeMs() - TICK_MS));
      }
      // The game is over once every clock that started with time has emptied.
      if (this._hoop1TimeMs() <= 0 && this._hoop2TimeMs() <= 0) {
        this.finish();
      }
    }, TICK_MS);
  }

  private finish(): void {
    this.clearTimer();
    this.stopListeningForShots();
    const setup = this._setup();
    if (!setup) return;

    const hoop1Score = this.hoop1Score();
    const hoop2Score = this.hoop2Score();
    const isSinglePlayer = this.isSinglePlayer();

    // A solo run has no opponent, so there's no winner and never a tie.
    const isTie = !isSinglePlayer && hoop1Score === hoop2Score;
    const winner = isSinglePlayer || isTie
      ? null
      : hoop1Score > hoop2Score
        ? setup.hoop1Player
        : setup.hoop2Player;

    const result: GameResult = {
      mode: setup.mode,
      hoop1Player: setup.hoop1Player,
      hoop2Player: setup.hoop2Player,
      hoop1Shots: this.hoop1Shots(),
      hoop2Shots: this.hoop2Shots(),
      hoop1Score,
      hoop2Score,
      hoop1DurationSeconds: setup.hoop1Player
        ? Math.round(this._hoop1ElapsedMs() / 1000)
        : undefined,
      hoop2DurationSeconds: setup.hoop2Player
        ? Math.round(this._hoop2ElapsedMs() / 1000)
        : undefined,
      winner,
      isTie,
      isSinglePlayer,
    };

    this._result.set(result);
    this._status.set('finished');
    this.persistPromise = this.persistResult(result);
  }

  /** Resolves once the most recently finished game's write has settled. */
  whenPersisted(): Promise<void> {
    return this.persistPromise;
  }

  /** Persist the finished game to Supabase. No-op when not configured. */
  private async persistResult(result: GameResult): Promise<void> {
    const client = this.supabase.client;
    if (!client) return;

    const { error } = await client.from('games').insert({
      mode: result.mode.id,
      duration_seconds: result.mode.attrition?.startSeconds ?? result.mode.durationSeconds,
      hoop1_player_id: result.hoop1Player?.id ?? null,
      hoop2_player_id: result.hoop2Player?.id ?? null,
      hoop1_score: result.hoop1Score,
      hoop2_score: result.hoop2Score,
      hoop1_shots: result.hoop1Shots,
      hoop2_shots: result.hoop2Shots,
      hoop1_duration_seconds: result.hoop1DurationSeconds ?? null,
      hoop2_duration_seconds: result.hoop2DurationSeconds ?? null,
      winner_player_id: result.winner?.id ?? null,
    });

    if (error) {
      console.error('Failed to persist game to Supabase:', error.message);
    }
  }

  /** Set each clock to the starting value, leaving an unmanned hoop at zero. */
  private resetClocks(setup: GameSetup): void {
    const startMs = (setup.mode.attrition?.startSeconds ?? setup.mode.durationSeconds) * 1000;
    this._hoop1TimeMs.set(setup.hoop1Player ? startMs : 0);
    this._hoop2TimeMs.set(setup.hoop2Player ? startMs : 0);
  }

  /** The player assigned to a hoop, or null if that hoop is unmanned. */
  private playerForHoop(hoop: HoopId) {
    const setup = this._setup();
    if (!setup) return null;
    return hoop === 1 ? setup.hoop1Player : setup.hoop2Player;
  }

  private timeMs(hoop: HoopId): number {
    return hoop === 1 ? this._hoop1TimeMs() : this._hoop2TimeMs();
  }

  /** A player can shoot while the game is running, manned, and still on the clock. */
  private isActive(hoop: HoopId): boolean {
    return this._status() === 'running' && !!this.playerForHoop(hoop) && this.timeMs(hoop) > 0;
  }

  /** True while a player's clock is under the higher-scoring threshold. */
  private isLowTime(hoop: HoopId): boolean {
    const attrition = this._setup()?.mode.attrition;
    if (!attrition || !this.playerForHoop(hoop) || this.timeMs(hoop) <= 0) return false;
    return this.timeMs(hoop) < attrition.lowTimeThresholdSeconds * 1000;
  }

  private clockFill(timeMs: number): number {
    const startMs = (this._setup()?.mode.attrition?.startSeconds ?? 0) * 1000;
    if (startMs <= 0) return 0;
    return Math.min(1, timeMs / startMs);
  }

  private clearTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Connect to the broker and route incoming shot events into the score. */
  private startListeningForShots(): void {
    this.mqtt.connect();
    this.shotSub?.unsubscribe();
    this.shotSub = this.mqtt.shots$.subscribe((event) => this.recordShot(event.hoop));
  }

  /** Tear down the shot subscription and close the broker connection. */
  private stopListeningForShots(): void {
    this.shotSub?.unsubscribe();
    this.shotSub = null;
    this.mqtt.disconnect();
  }
}
