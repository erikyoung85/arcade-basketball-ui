import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { SupabaseService } from '../supabase/supabase.client';
import { SensorService } from './sensor.service';
import { GameResult, GameSetup, GameStatus, HoopId } from '../models/game.model';
import { PausableGame } from '../models/pausable-game';

/** Length of the pre-game "3 · 2 · 1 · GO" countdown, in seconds. */
const COUNTDOWN_SECONDS = 3;
/** Game-clock tick interval. Small enough for a smooth progress ring. */
const TICK_MS = 100;

/**
 * Owns the state of a single, locally-managed game: the chosen setup, live
 * scores, the countdown + game clock, and the final result. Nothing is written
 * to Supabase until the game finishes.
 *
 * Provided in root so state survives navigation between the setup, game and
 * results routes.
 */
@Injectable({ providedIn: 'root' })
export class GameService implements PausableGame {
  private readonly supabase = inject(SupabaseService);
  private readonly sensor = inject(SensorService);

  private readonly _setup = signal<GameSetup | null>(null);
  private readonly _status = signal<GameStatus>('idle');
  // The point value of each made shot, captured at the moment it was scored.
  // Modes like Clutch Time award different points depending on the game clock,
  // so we can't just multiply a count by a flat per-shot value after the fact.
  private readonly _hoop1ShotPoints = signal<number[]>([]);
  private readonly _hoop2ShotPoints = signal<number[]>([]);
  private readonly _countdownValue = signal(COUNTDOWN_SECONDS);
  private readonly _timeRemainingMs = signal(0);
  private readonly _result = signal<GameResult | null>(null);

  /** Public read-only views of state. */
  readonly setup = this._setup.asReadonly();
  readonly status = this._status.asReadonly();
  readonly countdownValue = this._countdownValue.asReadonly();
  readonly timeRemainingMs = this._timeRemainingMs.asReadonly();
  readonly result = this._result.asReadonly();

  readonly hoop1Shots = computed(() => this._hoop1ShotPoints().length);
  readonly hoop2Shots = computed(() => this._hoop2ShotPoints().length);

  /** True while the clock is live, so a sensor drop now should pause the game. */
  readonly isLive = computed(() => this._status() === 'running');
  /** True while play is frozen, waiting for the sensors to reconnect. */
  readonly isAwaitingSensors = computed(() => this._status() === 'paused');

  /** Whole seconds left on the game clock (rounded up for display). */
  readonly secondsRemaining = computed(() => Math.ceil(this._timeRemainingMs() / 1000));

  /** 0–1 fraction of the game clock elapsed, for progress indicators. */
  readonly progress = computed(() => {
    const total = this._setup()?.mode.durationSeconds ?? 0;
    if (total <= 0) return 0;
    return 1 - this._timeRemainingMs() / (total * 1000);
  });

  readonly hoop1Score = computed(() => this._hoop1ShotPoints().reduce((sum, p) => sum + p, 0));
  readonly hoop2Score = computed(() => this._hoop2ShotPoints().reduce((sum, p) => sum + p, 0));

  /**
   * True when only one hoop has a player — a solo run for the leaderboard
   * rather than a head-to-head. Shots on the unmanned hoop are ignored.
   */
  readonly isSinglePlayer = computed(() => {
    const setup = this._setup();
    if (!setup) return false;
    return !setup.hoop1Player !== !setup.hoop2Player;
  });

  /**
   * True while a clutch-scoring mode is in its final stretch — the window in
   * which baskets are worth more. Drives the on-screen "Clutch Time" banner.
   */
  readonly isClutchActive = computed(() => {
    const clutch = this._setup()?.mode.clutch;
    if (!clutch || this._status() !== 'running') return false;
    return this.secondsRemaining() <= clutch.thresholdSeconds;
  });

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
    this._timeRemainingMs.set(setup.mode.durationSeconds * 1000);
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

  /** Run the pre-game countdown, then start the game clock. */
  startCountdown(): void {
    if (!this._setup() || (this._status() !== 'idle' && this._status() !== 'preparing')) return;
    this._status.set('countdown');
    this._countdownValue.set(COUNTDOWN_SECONDS);

    // Start routing shots now; they're ignored until the status is 'running'
    // (see recordShot). The socket itself is already connected app-wide.
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
   * Record a made shot on the given hoop while the game is running. Driven by
   * made-shot events from the sensors (see startListeningForShots).
   */
  recordShot(hoop: HoopId): void {
    if (this._status() !== 'running') return;
    // Ignore shots on a hoop with no player (e.g. the empty hoop in a solo game).
    if (!this.playerForHoop(hoop)) return;
    const points = this.currentShotValue();
    if (hoop === 1) {
      this._hoop1ShotPoints.update((p) => [...p, points]);
    } else {
      this._hoop2ShotPoints.update((p) => [...p, points]);
    }
  }

  /** Undo the most recent made shot on a hoop (corrects a false sensor read). */
  undoShot(hoop: HoopId): void {
    if (this._status() !== 'running') return;
    if (hoop === 1) {
      this._hoop1ShotPoints.update((p) => p.slice(0, -1));
    } else {
      this._hoop2ShotPoints.update((p) => p.slice(0, -1));
    }
  }

  /**
   * Points a made shot is worth right now. Clutch modes award more once the
   * clock drops into their final window; otherwise it's the flat per-shot value.
   */
  /** The player assigned to a hoop, or null if that hoop is unmanned. */
  private playerForHoop(hoop: HoopId) {
    const setup = this._setup();
    if (!setup) return null;
    return hoop === 1 ? setup.hoop1Player : setup.hoop2Player;
  }

  private currentShotValue(): number {
    const mode = this._setup()?.mode;
    if (!mode) return 0;
    if (mode.clutch && this.secondsRemaining() <= mode.clutch.thresholdSeconds) {
      return mode.clutch.pointsPerShot;
    }
    return mode.pointsPerShot;
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
    this._timeRemainingMs.set(0);
    this._countdownValue.set(COUNTDOWN_SECONDS);
  }

  private beginPlay(): void {
    const setup = this._setup();
    if (!setup) return;
    this._timeRemainingMs.set(setup.mode.durationSeconds * 1000);
    this.startClock();
  }

  /**
   * Start (or restart) the game clock from whatever time is on it now. Used both
   * to begin play and to resume after a sensor-loss pause, so it never resets
   * the remaining time itself — the caller decides that.
   */
  private startClock(): void {
    this._status.set('running');
    this.clearTimer();
    this.intervalId = setInterval(() => {
      const remaining = this._timeRemainingMs() - TICK_MS;
      if (remaining <= 0) {
        this._timeRemainingMs.set(0);
        this.finish();
      } else {
        this._timeRemainingMs.set(remaining);
      }
    }, TICK_MS);
  }

  /** Freeze the game clock because the hoop sensors dropped mid-game. */
  pauseForSensorLoss(): void {
    if (this._status() !== 'running') return;
    this.clearTimer();
    this._status.set('paused');
  }

  /** Resume after a sensor-loss pause: replay the 3·2·1 countdown, then play on. */
  resumeAfterSensorLoss(): void {
    if (this._status() !== 'paused') return;
    this._status.set('countdown');
    this._countdownValue.set(COUNTDOWN_SECONDS);
    this.clearTimer();
    this.intervalId = setInterval(() => {
      const next = this._countdownValue() - 1;
      if (next <= 0) {
        this.clearTimer();
        this.startClock(); // Continues from the frozen time on the clock.
      } else {
        this._countdownValue.set(next);
      }
    }, 1000);
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
      duration_seconds: result.mode.durationSeconds,
      hoop1_player_id: result.hoop1Player?.id ?? null,
      hoop2_player_id: result.hoop2Player?.id ?? null,
      hoop1_score: result.hoop1Score,
      hoop2_score: result.hoop2Score,
      hoop1_shots: result.hoop1Shots,
      hoop2_shots: result.hoop2Shots,
      winner_player_id: result.winner?.id ?? null,
    });

    if (error) {
      console.error('Failed to persist game to Supabase:', error.message);
    }
  }

  private clearTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Route incoming shot events into the score. The sensor WebSocket is opened
   * once, app-wide (see App), and stays connected across games — we only
   * attach/detach our subscription here, never the socket itself.
   */
  private startListeningForShots(): void {
    this.shotSub?.unsubscribe();
    this.shotSub = this.sensor.shots$.subscribe((event) => this.recordShot(event.hoop));
  }

  /** Detach the shot subscription, leaving the shared socket connected. */
  private stopListeningForShots(): void {
    this.shotSub?.unsubscribe();
    this.shotSub = null;
  }
}
