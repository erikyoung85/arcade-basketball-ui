import { Injectable, signal } from '@angular/core';

import {
  DEFAULT_GAME_MODE,
  DEFAULT_GAME_MODE_GROUP,
  GameMode,
} from '../models/game-mode.model';
import { Player } from '../models/player.model';

/** The steps of the setup wizard: pick a mode, then pick the players. */
export type SetupStep = 1 | 2;

/**
 * Remembers the in-progress setup-wizard selections — which step the operator
 * is on, the chosen mode group/mode, and the player for each hoop — so they
 * persist when the operator navigates away (e.g. into test mode or a game) and
 * returns to the landing page.
 *
 * Provided in root and held purely in memory: selections survive navigation
 * between routes but reset on a full page refresh, which is the intended
 * behaviour (a fresh load starts from a clean default setup).
 */
@Injectable({ providedIn: 'root' })
export class SetupStateService {
  /** Which wizard step is showing. */
  readonly step = signal<SetupStep>(1);
  /** The selected mode group (Standard / Clutch Time / Back to Back). */
  readonly groupId = signal<string>(DEFAULT_GAME_MODE_GROUP.id);
  /**
   * The resolved game mode. For single-variant groups it's set as soon as the
   * group is picked; for multi-variant groups (Back to Back) it stays null
   * until the operator chooses a sub-option.
   */
  readonly mode = signal<GameMode | null>(DEFAULT_GAME_MODE);
  readonly hoop1Player = signal<Player | null>(null);
  readonly hoop2Player = signal<Player | null>(null);
}
