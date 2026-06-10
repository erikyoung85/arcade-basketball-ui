/** Identifier for a game mode. Add new ids here as modes are introduced. */
export type GameModeId = 'standard' | 'clutch' | 'back-to-back-vs' | 'back-to-back-team';

/**
 * Seconds each player has to make their shot on their turn in the back-to-back
 * modes. Once this elapses with no made shot, the turn is recorded as a miss.
 */
export const TIME_TO_SHOOT_SECONDS = 3;

/**
 * Strikes that end a back-to-back game. In "vs" it's per-player (first to this
 * many strikes loses); in "team" it's shared by the duo.
 */
export const BACK_TO_BACK_MAX_STRIKES = 3;

/** Late-game scoring boost (e.g. "Clutch Time"). */
export interface ClutchConfig {
  /** Clutch scoring kicks in once this many seconds (or fewer) remain. */
  thresholdSeconds: number;
  /** Points awarded per made shot once clutch time has begun. */
  pointsPerShot: number;
}

/**
 * Configuration for the turn-based "back to back" modes, where players take
 * turns shooting a single shot against a per-turn clock and accumulate strikes
 * rather than points.
 */
export interface BackToBackConfig {
  /** Seconds a player has to make their shot before the turn counts as a miss. */
  timeToShootSeconds: number;
  /** Strikes that end the game (per-player in vs, shared in team). */
  maxStrikes: number;
  /**
   * When true, the players co-operate as a single team sharing one strike
   * count (a solo player plays alone). When false, it's head-to-head: each
   * player has their own strikes and the first to {@link maxStrikes} loses.
   */
  team: boolean;
}

/** Static configuration describing how a game mode is played. */
export interface GameMode {
  id: GameModeId;
  name: string;
  description: string;
  /** Length of the game in seconds. */
  durationSeconds: number;
  /** Points awarded per made shot. */
  pointsPerShot: number;
  /**
   * When true, the mode can only be started with a player on both hoops. When
   * false (or omitted), a single player may play solo. Source of truth for the
   * setup screen's 2-player gate and "2 players only" tag.
   */
  requiresTwoPlayers?: boolean;
  /**
   * Optional late-game scoring boost. When set, shots made within the final
   * `thresholdSeconds` are worth `clutch.pointsPerShot` instead of
   * `pointsPerShot`.
   */
  clutch?: ClutchConfig;
  /**
   * When set, this is a turn-based "back to back" mode rather than a timed
   * scoring mode. `durationSeconds`/`pointsPerShot` are unused for these modes.
   * See {@link isBackToBack}.
   */
  backToBack?: BackToBackConfig;
}

/** True when a mode is one of the turn-based "back to back" strike modes. */
export function isBackToBack(mode: GameMode): boolean {
  return !!mode.backToBack;
}

/** All game modes available for selection on the setup screen. */
export const GAME_MODES: readonly GameMode[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: '30 seconds. Most points wins. Every made shot is worth 2.',
    durationSeconds: 30,
    pointsPerShot: 2,
  },
  {
    id: 'clutch',
    name: 'Clutch Time',
    description:
      '60 seconds. Baskets are worth 2 — but in the final 15 seconds it’s Clutch Time and every basket is worth 3.',
    durationSeconds: 60,
    pointsPerShot: 2,
    clutch: { thresholdSeconds: 15, pointsPerShot: 3 },
  },
  {
    id: 'back-to-back-vs',
    name: 'Back to Back - VS',
    description:
      'Head-to-head. Players alternate single shots. Miss while your rival scores and you take a strike — three strikes and you lose.',
    durationSeconds: TIME_TO_SHOOT_SECONDS,
    pointsPerShot: 0,
    requiresTwoPlayers: true,
    backToBack: {
      timeToShootSeconds: TIME_TO_SHOOT_SECONDS,
      maxStrikes: BACK_TO_BACK_MAX_STRIKES,
      team: false,
    },
  },
  {
    id: 'back-to-back-team',
    name: 'Back to Back - Team',
    description:
      'Work as a team. Take turns shooting. Any miss in a round costs the team one strike. Survive as many rounds as you can before three strikes ends the run.',
    durationSeconds: TIME_TO_SHOOT_SECONDS,
    pointsPerShot: 0,
    requiresTwoPlayers: true,
    backToBack: {
      timeToShootSeconds: TIME_TO_SHOOT_SECONDS,
      maxStrikes: BACK_TO_BACK_MAX_STRIKES,
      team: true,
    },
  },
];

export const DEFAULT_GAME_MODE: GameMode = GAME_MODES[0];
