/** Identifier for a game mode. Add new ids here as modes are introduced. */
export type GameModeId =
  | 'standard'
  | 'clutch'
  | 'attrition'
  | 'back-to-back-solo'
  | 'back-to-back-vs'
  | 'back-to-back-team';

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
 * Configuration for the "Attrition" mode, where each player runs their own
 * countdown clock instead of a single shared game timer. A made shot extends
 * that player's clock and banks points (more when the clock is low); a player
 * is done the moment their own clock hits zero, while the other plays on.
 */
export interface AttritionConfig {
  /** Seconds each player's clock starts at. */
  startSeconds: number;
  /** Seconds added to a player's own clock for each made shot. */
  secondsPerShot: number;
  /**
   * When a player's clock is *below* this many seconds at the moment a shot is
   * made, the basket is worth {@link lowTimePoints} instead of the base value.
   */
  lowTimeThresholdSeconds: number;
  /** Points a made shot is worth while the clock is under the low-time threshold. */
  lowTimePoints: number;
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
  requiresTwoPlayers: boolean;
  /**
   * When true, the mode is single-player only: exactly one player, who may pick
   * either basket. Source of truth for the setup screen's solo player-count
   * rule and "1P" tag, and for the solo back-to-back leaderboard/labels.
   */
  requiresSoloPlayer: boolean;
  /**
   * Optional late-game scoring boost. When set, shots made within the final
   * `thresholdSeconds` are worth `clutch.pointsPerShot` instead of
   * `pointsPerShot`.
   */
  clutch?: ClutchConfig;
  /**
   * When set, this is the "Attrition" mode: each player runs an independent
   * countdown clock rather than sharing one game timer. `durationSeconds` holds
   * the starting clock value and `pointsPerShot` the base basket value; the
   * rest of the rules live here. See {@link isAttrition}.
   */
  attrition?: AttritionConfig;
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

/** True when a mode is the per-player-clock "Attrition" mode. */
export function isAttrition(mode: GameMode): boolean {
  return !!mode.attrition;
}

/** All game modes available for selection on the setup screen. */
export const GAME_MODES: readonly GameMode[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: '30 seconds. Most points wins. Every made shot is worth 2.',
    durationSeconds: 30,
    pointsPerShot: 2,
    requiresSoloPlayer: false,
    requiresTwoPlayers: false,
  },
  {
    id: 'clutch',
    name: 'Clutch Time',
    description:
      '60 seconds. Baskets are worth 2 — but in the final 15 seconds it’s Clutch Time and every basket is worth 3.',
    durationSeconds: 60,
    pointsPerShot: 2,
    requiresSoloPlayer: false,
    requiresTwoPlayers: false,
    clutch: { thresholdSeconds: 15, pointsPerShot: 3 },
  },
  {
    id: 'attrition',
    name: 'Attrition',
    description:
      'Each player races their own clock. Every basket banks 2 points and buys 2 more seconds — but sink one with under 7 seconds left and it’s worth 3.',
    durationSeconds: 20,
    pointsPerShot: 2,
    requiresSoloPlayer: false,
    requiresTwoPlayers: false,
    attrition: {
      startSeconds: 20,
      secondsPerShot: 2,
      lowTimeThresholdSeconds: 7,
      lowTimePoints: 3,
    },
  },
  {
    id: 'back-to-back-solo',
    name: 'Back to Back - Solo',
    description:
      'Solo run. One basket, one shot each round against the clock. Miss and you take a strike — survive as many rounds as you can before three strikes ends the run.',
    durationSeconds: TIME_TO_SHOOT_SECONDS,
    pointsPerShot: 0,
    requiresSoloPlayer: true,
    requiresTwoPlayers: false,
    backToBack: {
      timeToShootSeconds: TIME_TO_SHOOT_SECONDS,
      maxStrikes: BACK_TO_BACK_MAX_STRIKES,
      team: true,
    },
  },
  {
    id: 'back-to-back-vs',
    name: 'Back to Back - VS',
    description:
      'Head-to-head. Players alternate single shots. Miss while your rival scores and you take a strike — three strikes and you lose.',
    durationSeconds: TIME_TO_SHOOT_SECONDS,
    pointsPerShot: 0,
    requiresSoloPlayer: false,
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
    requiresSoloPlayer: false,
    requiresTwoPlayers: true,
    backToBack: {
      timeToShootSeconds: TIME_TO_SHOOT_SECONDS,
      maxStrikes: BACK_TO_BACK_MAX_STRIKES,
      team: true,
    },
  },
];

export const DEFAULT_GAME_MODE: GameMode = GAME_MODES[0];

/** Look up a mode by id, throwing if it doesn't exist (build-time safety). */
function mode(id: GameModeId): GameMode {
  const found = GAME_MODES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown game mode: ${id}`);
  return found;
}

/** A selectable sub-option within a {@link GameModeGroup}. */
export interface GameModeVariant {
  /** Short label for the sub-option button (e.g. "VS", "Team"). */
  label: string;
  mode: GameMode;
}

/**
 * A group of related game modes shown as a single card on the setup screen.
 * Most groups hold one mode; groups with multiple variants (e.g. Back to Back)
 * reveal sub-option buttons once selected so the operator can pick the exact
 * game to play.
 */
export interface GameModeGroup {
  id: string;
  name: string;
  /** Blurb shown on the group card. */
  description: string;
  /** PrimeIcons class for the group card. */
  icon: string;
  variants: readonly GameModeVariant[];
}

/** Game mode groups, in display order, for the setup screen. */
export const GAME_MODE_GROUPS: readonly GameModeGroup[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: mode('standard').description,
    icon: 'pi pi-bolt',
    variants: [{ label: 'Standard', mode: mode('standard') }],
  },
  {
    id: 'clutch',
    name: 'Clutch Time',
    description: mode('clutch').description,
    icon: 'pi pi-clock',
    variants: [{ label: 'Clutch Time', mode: mode('clutch') }],
  },
  {
    id: 'attrition',
    name: 'Attrition',
    description: mode('attrition').description,
    icon: 'pi pi-hourglass',
    variants: [{ label: 'Attrition', mode: mode('attrition') }],
  },
  {
    id: 'back-to-back',
    name: 'Back to Back',
    description:
      'Take turns under a per-shot clock — three strikes and the run ends. Go it alone (Solo), head-to-head (VS), or co-operatively (Team).',
    icon: 'pi pi-sync',
    variants: [
      { label: 'Solo', mode: mode('back-to-back-solo') },
      { label: 'VS', mode: mode('back-to-back-vs') },
      { label: 'Team', mode: mode('back-to-back-team') },
    ],
  },
];

/** The group selected by default when the setup screen first loads. */
export const DEFAULT_GAME_MODE_GROUP: GameModeGroup = GAME_MODE_GROUPS[0];
