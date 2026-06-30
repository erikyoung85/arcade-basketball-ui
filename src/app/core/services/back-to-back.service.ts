import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { SupabaseService } from '../supabase/supabase.client';
import { SensorService } from './sensor.service';
import { SoundService } from './sound.service';
import {
  BackToBackResult,
  BackToBackStatus,
  RoundOutcome,
  ShotOutcome,
  TurnPhase,
  mannedHoops,
} from '../models/back-to-back.model';
import { GameSetup, HoopId } from '../models/game.model';
import { PausableGame } from '../models/pausable-game';
import { Player } from '../models/player.model';

/** Length of the pre-game "3 · 2 · 1" countdown, in seconds. */
const COUNTDOWN_SECONDS = 3;
/** Shot-clock tick interval. Small enough for a smooth countdown ring. */
const TICK_MS = 100;
/** "You're up" beat before a player's shot clock starts. */
const READY_MS = 1400;
/**
 * Grace window after the shot clock hits zero in which a made shot still counts.
 * Absorbs the latency between the ball dropping and the sensor's message
 * arriving, so a buzzer-beater isn't unfairly scored as a miss.
 */
const SHOT_GRACE_MS = 1000;
/** How long the made/missed verdict stays on screen after a turn. */
const TURN_RESULT_MS = 1000;
/** How long the round summary (strike / clean) stays on screen between rounds. */
const ROUND_RESULT_MS = 500;
/**
 * Pause after a team strike is handed out mid-round — long enough for the
 * "Strike!" call to land and register before the next player is called up for
 * their (now dead-rubber) practice shot.
 */
const STRIKE_ANNOUNCE_MS = 1500;

/**
 * Owns the state of a single turn-based "back to back" game: players take turns
 * shooting one shot against a per-turn clock, accumulating strikes until the
 * game ends. Two flavours, selected by the mode's {@link BackToBackConfig}:
 *
 *  - **vs** — head-to-head. Each player has their own strikes; whoever misses
 *    while their rival scores takes a strike. First to `maxStrikes` loses.
 *  - **team** — co-operative (or solo). One shared strike count; any miss in a
 *    round costs the team one strike (at most one per round). The game ranks on
 *    how many rounds the team survived.
 *
 * Provided in root so state survives navigation between the setup, game and
 * results routes. Mirrors {@link GameService} but for the turn-based modes.
 */
@Injectable({ providedIn: 'root' })
export class BackToBackService implements PausableGame {
  private readonly supabase = inject(SupabaseService);
  private readonly sensor = inject(SensorService);
  private readonly sound = inject(SoundService);

  private readonly _setup = signal<GameSetup | null>(null);
  private readonly _status = signal<BackToBackStatus>('idle');
  private readonly _countdownValue = signal(COUNTDOWN_SECONDS);
  private readonly _round = signal(1);
  private readonly _activeHoop = signal<HoopId | null>(null);
  private readonly _turnPhase = signal<TurnPhase>('ready');
  private readonly _turnMsRemaining = signal(0);
  /** Outcome of the turn currently being shown (during the `result` phase). */
  private readonly _turnOutcome = signal<ShotOutcome | null>(null);
  /**
   * True when the active turn no longer affects the round — a team-mode strike
   * has already been incurred this round, so this shot is just for practice.
   */
  private readonly _isPracticeTurn = signal(false);
  private readonly _hoop1Strikes = signal(0);
  private readonly _hoop2Strikes = signal(0);
  private readonly _teamStrikes = signal(0);
  private readonly _roundsSurvived = signal(0);
  private readonly _roundOutcome = signal<RoundOutcome | null>(null);
  private readonly _result = signal<BackToBackResult | null>(null);

  /** Public read-only views of state. */
  readonly setup = this._setup.asReadonly();
  readonly status = this._status.asReadonly();
  readonly countdownValue = this._countdownValue.asReadonly();
  readonly round = this._round.asReadonly();
  readonly activeHoop = this._activeHoop.asReadonly();
  readonly turnPhase = this._turnPhase.asReadonly();
  readonly turnOutcome = this._turnOutcome.asReadonly();
  readonly isPracticeTurn = this._isPracticeTurn.asReadonly();
  readonly hoop1Strikes = this._hoop1Strikes.asReadonly();
  readonly hoop2Strikes = this._hoop2Strikes.asReadonly();
  readonly teamStrikes = this._teamStrikes.asReadonly();
  readonly roundsSurvived = this._roundsSurvived.asReadonly();
  readonly roundOutcome = this._roundOutcome.asReadonly();
  readonly result = this._result.asReadonly();

  /** True while a round is in progress, so a sensor drop now should pause it. */
  readonly isLive = computed(() => this._status() === 'playing');
  /** True while play is frozen, waiting for the sensors to reconnect. */
  readonly isAwaitingSensors = computed(() => this._status() === 'paused');

  /** Whole seconds left on the shot clock (rounded up for display). */
  readonly secondsToShoot = computed(() => Math.ceil(this._turnMsRemaining() / 1000));

  /** 0–1 fraction of the shot clock still remaining, for a depleting bar. */
  readonly turnFraction = computed(() => {
    const total = (this._setup()?.mode.backToBack?.timeToShootSeconds ?? 0) * 1000;
    return total > 0 ? this._turnMsRemaining() / total : 0;
  });

  /** Max strikes this mode ends at, or 0 if not a back-to-back game. */
  readonly maxStrikes = computed(() => this._setup()?.mode.backToBack?.maxStrikes ?? 0);

  /** True for the co-operative team mode (includes the solo run). */
  readonly isTeam = computed(() => !!this._setup()?.mode.backToBack?.team);

  /** True for the single-player solo run. */
  readonly isSolo = computed(() => !!this._setup()?.mode.requiresSoloPlayer);

  /** True when only one hoop has a player (team mode played solo). */
  readonly isSinglePlayer = computed(() => {
    const setup = this._setup();
    if (!setup) return false;
    return !setup.hoop1Player !== !setup.hoop2Player;
  });

  /** The player currently taking their turn, or null between turns. */
  readonly activePlayer = computed(() => {
    const hoop = this._activeHoop();
    return hoop === null ? null : this.playerForHoop(hoop);
  });

  /** Strikes accrued by a hoop's player (vs mode). */
  strikesForHoop(hoop: HoopId): number {
    return hoop === 1 ? this._hoop1Strikes() : this._hoop2Strikes();
  }

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private shotSub: Subscription | null = null;
  /** Set while a shot window is open; resolves the turn the instant a shot lands. */
  private shotResolver: ((hoop: HoopId) => void) | null = null;
  /** Pending sleeps, kept so reset() can cancel them and let awaiters bail out. */
  private readonly timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  /** Tears down an open shot window early (on a made shot or a reset). */
  private shotWindowCleanup: (() => void) | null = null;
  /** Bumped on each new game / reset so stale async run-loops abort. */
  private generation = 0;
  /**
   * Strike counts captured at the start of the current round. A sensor-loss
   * pause rolls back to these so the resumed round replays cleanly, without
   * double-counting a strike already incurred in the interrupted round.
   */
  private roundStartStrikes: { hoop1: number; hoop2: number; team: number } | null = null;

  // Resolves once the most recent finished game has been written to Supabase.
  private persistPromise: Promise<void> = Promise.resolve();

  /** Store the setup chosen on the landing page and reset all game state. */
  configure(setup: GameSetup): void {
    this.abort();
    this._setup.set(setup);
    this._status.set('idle');
    this._countdownValue.set(COUNTDOWN_SECONDS);
    this._round.set(1);
    this._activeHoop.set(null);
    this._turnPhase.set('ready');
    this._turnMsRemaining.set(0);
    this._turnOutcome.set(null);
    this._isPracticeTurn.set(false);
    this._hoop1Strikes.set(0);
    this._hoop2Strikes.set(0);
    this._teamStrikes.set(0);
    this._roundsSurvived.set(0);
    this._roundOutcome.set(null);
    this._result.set(null);
  }

  /** Enter the brief "preparing" state shown while audio assets download. */
  markPreparing(): void {
    if (!this._setup() || this._status() !== 'idle') return;
    this._status.set('preparing');
  }

  /** Run the pre-game countdown, then start the first round. */
  startCountdown(): void {
    if (!this._setup() || (this._status() !== 'idle' && this._status() !== 'preparing')) return;

    // Start routing shots now so they land the moment play begins. The socket
    // itself is already connected app-wide.
    this.startListeningForShots();

    // Set countdown state and kick off the tick loop, which will transition to the first round.
    this._status.set('countdown');
    this._countdownValue.set(COUNTDOWN_SECONDS);

    this.clearInterval();
    this.intervalId = setInterval(() => {
      const next = this._countdownValue() - 1;
      if (next <= 0) {
        this.clearInterval();
        void this.runGame();
      } else {
        this._countdownValue.set(next);
      }
    }, 1000);
  }

  /** Reset everything back to idle (e.g. when leaving the game). */
  reset(): void {
    this.abort();
    this.stopListeningForShots();
    this._setup.set(null);
    this._status.set('idle');
    this._countdownValue.set(COUNTDOWN_SECONDS);
    this._round.set(1);
    this._activeHoop.set(null);
    this._turnPhase.set('ready');
    this._turnMsRemaining.set(0);
    this._turnOutcome.set(null);
    this._isPracticeTurn.set(false);
    this._hoop1Strikes.set(0);
    this._hoop2Strikes.set(0);
    this._teamStrikes.set(0);
    this._roundsSurvived.set(0);
    this._roundOutcome.set(null);
    this._result.set(null);
  }

  /** Resolves once the most recently finished game's write has settled. */
  whenPersisted(): Promise<void> {
    return this.persistPromise;
  }

  /**
   * Freeze the game because the hoop sensors dropped mid-round. Unwinds the
   * async run-loop and rolls the current round back to its starting strike
   * counts, so resuming replays that round from scratch without double-counting.
   */
  pauseForSensorLoss(): void {
    if (this._status() !== 'playing') return;
    this.abort();
    if (this.roundStartStrikes) {
      this._hoop1Strikes.set(this.roundStartStrikes.hoop1);
      this._hoop2Strikes.set(this.roundStartStrikes.hoop2);
      this._teamStrikes.set(this.roundStartStrikes.team);
    }
    this._roundOutcome.set(null);
    this._turnOutcome.set(null);
    this._activeHoop.set(null);
    this._turnPhase.set('ready');
    this._turnMsRemaining.set(0);
    this._isPracticeTurn.set(false);
    this._status.set('paused');
  }

  /**
   * Resume after a sensor-loss pause: replay the 3·2·1 countdown, then re-enter
   * the run-loop at the round that was interrupted.
   */
  resumeAfterSensorLoss(): void {
    if (this._status() !== 'paused') return;
    const round = this._round();
    this._status.set('countdown');
    this._countdownValue.set(COUNTDOWN_SECONDS);
    this.clearInterval();
    this.intervalId = setInterval(() => {
      const next = this._countdownValue() - 1;
      if (next <= 0) {
        this.clearInterval();
        void this.runGame(round);
      } else {
        this._countdownValue.set(next);
      }
    }, 1000);
  }

  // --- the round/turn run-loop ---------------------------------------------

  /**
   * The heart of the game: loop round by round, running each manned hoop's turn
   * in order, resolving strikes, and ending when the loss condition is met. A
   * `generation` token lets reset() abort a run cleanly mid-await. Starts at
   * `startRound` (1 for a fresh game, or the current round when resuming after a
   * sensor-loss pause), leaving the strike/survived counts untouched.
   */
  private async runGame(startRound = 1): Promise<void> {
    const setup = this._setup();
    if (!setup?.mode.backToBack) return;
    const myGen = this.generation;
    const hoops = mannedHoops(setup.hoop1Player, setup.hoop2Player);
    const team = setup.mode.backToBack.team;

    this._status.set('playing');
    let round = startRound;
    while (true) {
      this._round.set(round);
      this._roundOutcome.set(null);
      this._isPracticeTurn.set(false);
      // Snapshot strikes so a mid-round pause can roll back to a clean round.
      this.roundStartStrikes = {
        hoop1: this._hoop1Strikes(),
        hoop2: this._hoop2Strikes(),
        team: this._teamStrikes(),
      };

      const ended = team
        ? await this.runTeamRound(hoops, myGen)
        : await this.runVersusRound(hoops, myGen);
      if (myGen !== this.generation) return; // reset() while we were awaiting

      await this.sleep(ROUND_RESULT_MS);
      if (myGen !== this.generation) return;

      if (ended) {
        this.finish();
        return;
      }
      // Survived the round — bank it and play on.
      this._roundsSurvived.update((r) => r + 1);
      round++;
    }
  }

  /**
   * Team round: each player shoots in turn, but the team's single strike is
   * incurred — and shown/announced — the moment anyone misses. Once that
   * happens the round is already decided, so the remaining players still shoot
   * but only for practice. Returns true when the strike ended the game.
   */
  private async runTeamRound(hoops: HoopId[], myGen: number): Promise<boolean> {
    const max = this.maxStrikes();
    let struck = false;
    for (const hoop of hoops) {
      const outcome = await this.runTurn(hoop, myGen, struck);
      if (myGen !== this.generation) return false;

      if (!struck && outcome === 'missed') {
        struck = true;
        const next = this._teamStrikes() + 1;
        this._teamStrikes.set(next);
        this.sound.playStrike();
        const ended = next >= max;
        this._roundOutcome.set({
          struck: true,
          struckPlayer: null,
          message: ended ? 'Final strike — run over!' : `Strike! ${next} of ${max}`,
        });
        // The strike ended it — no point in a practice shot.
        if (ended) return true;
        // Let the strike call land before the next player is called up.
        await this.sleep(STRIKE_ANNOUNCE_MS);
        if (myGen !== this.generation) return false;
      }
    }
    if (!struck) {
      this._roundOutcome.set({ struck: false, struckPlayer: null, message: 'Clean round!' });
    }
    return false;
  }

  /**
   * Versus round: both players shoot, then strikes are resolved together — a
   * strike only when exactly one player missed while the other scored.
   * Returns true when the round ended the game.
   */
  private async runVersusRound(hoops: HoopId[], myGen: number): Promise<boolean> {
    const outcomes = new Map<HoopId, ShotOutcome>();
    for (const hoop of hoops) {
      const outcome = await this.runTurn(hoop, myGen, false);
      if (myGen !== this.generation) return false;
      outcomes.set(hoop, outcome);
    }
    return this.resolveVersusRound(outcomes);
  }

  /**
   * Run one player's turn: a made shot counts across the whole turn — during
   * the "you're up" beat, the visible shot clock, and a short grace window
   * after it (covering sensor latency on a buzzer-beater). Only if no shot lands
   * across all three is it a miss.
   */
  private async runTurn(hoop: HoopId, myGen: number, practice: boolean): Promise<ShotOutcome> {
    const player = this.playerForHoop(hoop);
    this._activeHoop.set(hoop);
    this._isPracticeTurn.set(practice);
    this._turnOutcome.set(null);
    this._turnPhase.set('ready');
    if (player) this.sound.playTurnCue(player.name, practice);

    const clockMs = (this._setup()?.mode.backToBack?.timeToShootSeconds ?? 0) * 1000;
    let outcome: ShotOutcome = 'missed';

    // 1. "You're up" beat — an eager shot already counts.
    if ((await this.waitForShot(hoop, READY_MS, myGen, false)) === 'made') {
      outcome = 'made';
    } else if (myGen === this.generation) {
      // 2. The visible shot clock.
      this._turnPhase.set('shooting');
      this.sound.playCountdown();
      if ((await this.waitForShot(hoop, clockMs, myGen, true)) === 'made') {
        outcome = 'made';
      } else if (myGen === this.generation) {
        // 3. Grace window for a late (sensor-delayed) basket.
        if ((await this.waitForShot(hoop, SHOT_GRACE_MS, myGen, false)) === 'made') {
          outcome = 'made';
        }
      }
    }

    if (myGen !== this.generation) return outcome;

    this.sound.stopCountdown();
    this._turnOutcome.set(outcome);
    this._turnPhase.set('result');
    if (outcome === 'made') this.sound.playShotMade();
    else this.sound.playShotMissed();

    await this.sleep(TURN_RESULT_MS);
    return outcome;
  }

  /**
   * Wait up to `ms` for a made shot on `hoop`, resolving 'made' the instant one
   * lands or 'missed' once the window elapses (or the game is reset). When
   * `countdown` is true the visible shot clock is driven down over the window.
   */
  private waitForShot(
    hoop: HoopId,
    ms: number,
    myGen: number,
    countdown: boolean,
  ): Promise<ShotOutcome> {
    return new Promise<ShotOutcome>((resolve) => {
      let settled = false;
      let remaining = ms;
      const finish = (outcome: ShotOutcome): void => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        this.shotResolver = null;
        this.shotWindowCleanup = null;
        resolve(outcome);
      };

      if (countdown) this._turnMsRemaining.set(remaining);
      this.shotResolver = (h) => {
        if (h === hoop) finish('made');
      };
      this.shotWindowCleanup = () => finish('missed');

      const interval = setInterval(() => {
        if (myGen !== this.generation) {
          finish('missed');
          return;
        }
        remaining -= TICK_MS;
        if (countdown) this._turnMsRemaining.set(Math.max(0, remaining));
        if (remaining <= 0) finish('missed');
      }, TICK_MS);
    });
  }

  /**
   * Apply a completed versus round's outcomes to the players' strike counts and
   * decide whether the game is over. A strike only when exactly one player
   * missed while the other scored. Returns true when the game has ended.
   */
  private resolveVersusRound(outcomes: Map<HoopId, ShotOutcome>): boolean {
    const max = this.maxStrikes();

    const o1 = outcomes.get(1);
    const o2 = outcomes.get(2);
    if (o1 && o2 && o1 !== o2) {
      const misserHoop: HoopId = o1 === 'missed' ? 1 : 2;
      const misser = this.playerForHoop(misserHoop);
      const next = this.strikesForHoop(misserHoop) + 1;
      if (misserHoop === 1) this._hoop1Strikes.set(next);
      else this._hoop2Strikes.set(next);
      this.sound.playStrike();
      const ended = next >= max;
      this._roundOutcome.set({
        struck: true,
        struckPlayer: misser,
        message: ended
          ? `${misser?.name} is out!`
          : `Strike on ${misser?.name} (${next} of ${max})`,
      });
      return ended;
    }

    const bothMade = o1 === 'made' && o2 === 'made';
    this._roundOutcome.set({
      struck: false,
      struckPlayer: null,
      message: bothMade ? 'Both scored — no strikes!' : 'Both missed — no harm done!',
    });
    return false;
  }

  private finish(): void {
    this.abort();
    this.stopListeningForShots();
    const setup = this._setup();
    if (!setup?.mode.backToBack) return;

    const isTeam = setup.mode.backToBack.team;
    const hoop1Strikes = this._hoop1Strikes();
    const hoop2Strikes = this._hoop2Strikes();
    const max = setup.mode.backToBack.maxStrikes;

    let winner: Player | null = null;
    let loser: Player | null = null;
    if (!isTeam) {
      // Whoever reached the strike limit lost; the other player won.
      if (hoop1Strikes >= max) {
        loser = setup.hoop1Player;
        winner = setup.hoop2Player;
      } else if (hoop2Strikes >= max) {
        loser = setup.hoop2Player;
        winner = setup.hoop1Player;
      }
    }

    const result: BackToBackResult = {
      mode: setup.mode,
      hoop1Player: setup.hoop1Player,
      hoop2Player: setup.hoop2Player,
      hoop1Strikes,
      hoop2Strikes,
      teamStrikes: this._teamStrikes(),
      roundsSurvived: this._roundsSurvived(),
      winner,
      loser,
      isTeam,
      isSolo: !!setup.mode.requiresSoloPlayer,
      isSinglePlayer: this.isSinglePlayer(),
    };

    this._result.set(result);
    this._status.set('finished');
    this.persistPromise = this.persistResult(result);
  }

  /**
   * Persist the finished game to Supabase, reusing the shared `games` table.
   * For team games we store the rounds survived in both score columns (that's
   * what the team leaderboard ranks on); for vs games we store each player's
   * strikes and the winner. No-op when Supabase isn't configured.
   */
  private async persistResult(result: BackToBackResult): Promise<void> {
    const client = this.supabase.client;
    if (!client) return;

    const score = result.isTeam ? result.roundsSurvived : 0;
    const { error } = await client.from('games').insert({
      mode: result.mode.id,
      duration_seconds: result.mode.backToBack?.timeToShootSeconds ?? 0,
      hoop1_player_id: result.hoop1Player?.id ?? null,
      hoop2_player_id: result.hoop2Player?.id ?? null,
      hoop1_score: result.isTeam ? score : result.hoop1Strikes,
      hoop2_score: result.isTeam ? score : result.hoop2Strikes,
      hoop1_shots: 0,
      hoop2_shots: 0,
      winner_player_id: result.winner?.id ?? null,
    });

    if (error) {
      console.error('Failed to persist back-to-back game to Supabase:', error.message);
    }
  }

  // --- internals -----------------------------------------------------------

  /** The player assigned to a hoop, or null if that hoop is unmanned. */
  private playerForHoop(hoop: HoopId): Player | null {
    const setup = this._setup();
    if (!setup) return null;
    return hoop === 1 ? setup.hoop1Player : setup.hoop2Player;
  }

  /** A cancelable delay. reset() resolves any pending sleeps so awaiters unwind. */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = setTimeout(() => {
        this.timers.delete(id);
        resolve();
      }, ms);
      this.timers.set(id, resolve);
    });
  }

  /** Stop the run-loop: bump the generation token and clear every live timer. */
  private abort(): void {
    this.generation++;
    this.clearInterval();
    for (const [id, resolve] of this.timers) {
      clearTimeout(id);
      resolve();
    }
    this.timers.clear();
    this.shotWindowCleanup?.();
    this.shotWindowCleanup = null;
    this.shotResolver = null;
    this.sound.stopCountdown();
  }

  private clearInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Route incoming shot events into the live turn. The sensor WebSocket is
   * opened once, app-wide (see App), and stays connected across games — we only
   * attach/detach our subscription here, never the socket itself.
   */
  private startListeningForShots(): void {
    this.shotSub?.unsubscribe();
    this.shotSub = this.sensor.shots$.subscribe((event) => this.shotResolver?.(event.hoop));
  }

  /** Detach the shot subscription, leaving the shared socket connected. */
  private stopListeningForShots(): void {
    this.shotSub?.unsubscribe();
    this.shotSub = null;
  }
}
