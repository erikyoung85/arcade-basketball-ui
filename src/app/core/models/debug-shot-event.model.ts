/**
 * Raw JSON payload the sensor pushes over the WebSocket while in debug mode.
 * `eventLog` is human-readable diagnostic text for the shot that was just taken
 * and may contain newline characters.
 */
export interface RawDebugShotPayload {
  hoop: string;
  isShotMade: boolean;
  eventLog: string[];
}

/** A parsed, validated debug-shot event. */
export interface DebugShotEvent {
  /** Which hoop the shot occurred on (HOOP_1 or HOOP_2). */
  hoop: string;
  /** Whether the sensor scored the shot as made. */
  isShotMade: boolean;
  /** Multi-line diagnostic log for the shot, displayed verbatim. */
  eventLog: string[];
}
