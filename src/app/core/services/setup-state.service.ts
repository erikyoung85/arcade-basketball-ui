import { Injectable, signal } from '@angular/core';

import { DEFAULT_GAME_MODE, GameMode } from '../models/game-mode.model';
import { Player } from '../models/player.model';

/**
 * Remembers the last selections made on the setup screen — game mode and the
 * player for each hoop — so they persist when the operator plays a game and
 * returns to the landing page.
 *
 * Provided in root and held purely in memory: selections survive navigation
 * between routes but reset on a full page refresh, which is the intended
 * behaviour (a fresh load starts from a clean default setup).
 */
@Injectable({ providedIn: 'root' })
export class SetupStateService {
  readonly mode = signal<GameMode>(DEFAULT_GAME_MODE);
  readonly hoop1Player = signal<Player | null>(null);
  readonly hoop2Player = signal<Player | null>(null);
}
