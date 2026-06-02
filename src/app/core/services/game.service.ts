import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../supabase/supabase.client';
import { GameResult, GameSetup, GameStatus, HoopId } from '../models/game.model';

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
export class GameService {
  private readonly supabase = inject(SupabaseService);

  private readonly _setup = signal<GameSetup | null>(null);
  private readonly _status = signal<GameStatus>('idle');
  private readonly _hoop1Shots = signal(0);
  private readonly _hoop2Shots = signal(0);
  private readonly _countdownValue = signal(COUNTDOWN_SECONDS);
  private readonly _timeRemainingMs = signal(0);
  private readonly _result = signal<GameResult | null>(null);

  /** Public read-only views of state. */
  readonly setup = this._setup.asReadonly();
  readonly status = this._status.asReadonly();
  readonly hoop1Shots = this._hoop1Shots.asReadonly();
  readonly hoop2Shots = this._hoop2Shots.asReadonly();
  readonly countdownValue = this._countdownValue.asReadonly();
  readonly timeRemainingMs = this._timeRemainingMs.asReadonly();
  readonly result = this._result.asReadonly();

  /** Whole seconds left on the game clock (rounded up for display). */
  readonly secondsRemaining = computed(() => Math.ceil(this._timeRemainingMs() / 1000));

  /** 0–1 fraction of the game clock elapsed, for progress indicators. */
  readonly progress = computed(() => {
    const total = this._setup()?.mode.durationSeconds ?? 0;
    if (total <= 0) return 0;
    return 1 - this._timeRemainingMs() / (total * 1000);
  });

  readonly hoop1Score = computed(
    () => this._hoop1Shots() * (this._setup()?.mode.pointsPerShot ?? 0),
  );
  readonly hoop2Score = computed(
    () => this._hoop2Shots() * (this._setup()?.mode.pointsPerShot ?? 0),
  );

  private intervalId: ReturnType<typeof setInterval> | null = null;

  /** Store the setup chosen on the landing page. */
  configure(setup: GameSetup): void {
    this.clearTimer();
    this._setup.set(setup);
    this._hoop1Shots.set(0);
    this._hoop2Shots.set(0);
    this._result.set(null);
    this._status.set('idle');
    this._timeRemainingMs.set(setup.mode.durationSeconds * 1000);
    this._countdownValue.set(COUNTDOWN_SECONDS);
  }

  /** Run the pre-game countdown, then start the game clock. */
  startCountdown(): void {
    if (!this._setup() || this._status() !== 'idle') return;
    this._status.set('countdown');
    this._countdownValue.set(COUNTDOWN_SECONDS);

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

  /** Record a made shot on the given hoop while the game is running. */
  recordShot(hoop: HoopId): void {
    if (this._status() !== 'running') return;
    if (hoop === 1) {
      this._hoop1Shots.update((n) => n + 1);
    } else {
      this._hoop2Shots.update((n) => n + 1);
    }
  }

  /** Undo the most recent made shot on a hoop (touchscreen mis-tap fix). */
  undoShot(hoop: HoopId): void {
    if (this._status() !== 'running') return;
    if (hoop === 1) {
      this._hoop1Shots.update((n) => Math.max(0, n - 1));
    } else {
      this._hoop2Shots.update((n) => Math.max(0, n - 1));
    }
  }

  /** Reset everything back to idle (e.g. when leaving the game). */
  reset(): void {
    this.clearTimer();
    this._setup.set(null);
    this._status.set('idle');
    this._hoop1Shots.set(0);
    this._hoop2Shots.set(0);
    this._result.set(null);
    this._timeRemainingMs.set(0);
    this._countdownValue.set(COUNTDOWN_SECONDS);
  }

  private beginPlay(): void {
    const setup = this._setup();
    if (!setup) return;

    this._status.set('running');
    this._timeRemainingMs.set(setup.mode.durationSeconds * 1000);

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

  private finish(): void {
    this.clearTimer();
    const setup = this._setup();
    if (!setup) return;

    const hoop1Score = this.hoop1Score();
    const hoop2Score = this.hoop2Score();
    const isTie = hoop1Score === hoop2Score;
    const winner = isTie
      ? null
      : hoop1Score > hoop2Score
        ? setup.hoop1Player
        : setup.hoop2Player;

    const result: GameResult = {
      mode: setup.mode,
      hoop1Player: setup.hoop1Player,
      hoop2Player: setup.hoop2Player,
      hoop1Shots: this._hoop1Shots(),
      hoop2Shots: this._hoop2Shots(),
      hoop1Score,
      hoop2Score,
      winner,
      isTie,
    };

    this._result.set(result);
    this._status.set('finished');
    void this.persistResult(result);
  }

  /** Persist the finished game to Supabase. No-op when not configured. */
  private async persistResult(result: GameResult): Promise<void> {
    const client = this.supabase.client;
    if (!client) return;

    const { error } = await client.from('games').insert({
      mode: result.mode.id,
      duration_seconds: result.mode.durationSeconds,
      hoop1_player_id: result.hoop1Player.id,
      hoop2_player_id: result.hoop2Player.id,
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
}
