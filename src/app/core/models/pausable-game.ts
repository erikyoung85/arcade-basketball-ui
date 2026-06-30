import { Signal } from '@angular/core';

/**
 * Contract a game engine exposes so the shared sensor-connection overlay can
 * freeze play when the hoop sensors drop mid-game and resume it once they
 * reconnect. Implemented by every game-mode service (standard, attrition,
 * back-to-back) so the overlay can drive them all uniformly.
 */
export interface PausableGame {
  /** True while play is live, so a sensor drop right now should pause the game. */
  readonly isLive: Signal<boolean>;
  /** True while play is frozen, waiting for the sensors to reconnect. */
  readonly isAwaitingSensors: Signal<boolean>;
  /** Freeze play because the sensor link dropped mid-game. */
  pauseForSensorLoss(): void;
  /** Resume play — after a fresh countdown — once the sensors reconnect. */
  resumeAfterSensorLoss(): void;
  /** Abandon the game entirely and return to an idle state (operator exit). */
  reset(): void;
}
