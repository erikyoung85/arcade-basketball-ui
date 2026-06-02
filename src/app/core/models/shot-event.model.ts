import { HoopId } from './game.model';

/** The hoop labels used in the `basketball/shots` MQTT payload. */
export type RawHoop = 'HOOP_1' | 'HOOP_2';

/** Raw JSON payload published on the `basketball/shots` topic. */
export interface RawShotPayload {
  hoop: RawHoop;
  /** Epoch milliseconds the sensor detected the made shot. */
  ts: number;
}

/** A parsed, validated made-shot event. */
export interface ShotEvent {
  hoop: HoopId;
  ts: number;
}

/** Map the broker's hoop label to our internal HoopId, or null if unknown. */
export function hoopFromRaw(raw: unknown): HoopId | null {
  switch (raw) {
    case 'HOOP_1':
      return 1;
    case 'HOOP_2':
      return 2;
    default:
      return null;
  }
}
