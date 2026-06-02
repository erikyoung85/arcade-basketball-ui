/** Identifier for a game mode. Add new ids here as modes are introduced. */
export type GameModeId = 'standard';

/** Static configuration describing how a game mode is played. */
export interface GameMode {
  id: GameModeId;
  name: string;
  description: string;
  /** Length of the game in seconds. */
  durationSeconds: number;
  /** Points awarded per made shot. */
  pointsPerShot: number;
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
];

export const DEFAULT_GAME_MODE: GameMode = GAME_MODES[0];
