/** Identifier for a game mode. Add new ids here as modes are introduced. */
export type GameModeId = 'standard' | 'clutch';

/** Late-game scoring boost (e.g. "Clutch Time"). */
export interface ClutchConfig {
  /** Clutch scoring kicks in once this many seconds (or fewer) remain. */
  thresholdSeconds: number;
  /** Points awarded per made shot once clutch time has begun. */
  pointsPerShot: number;
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
   * Optional late-game scoring boost. When set, shots made within the final
   * `thresholdSeconds` are worth `clutch.pointsPerShot` instead of
   * `pointsPerShot`.
   */
  clutch?: ClutchConfig;
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
];

export const DEFAULT_GAME_MODE: GameMode = GAME_MODES[0];
