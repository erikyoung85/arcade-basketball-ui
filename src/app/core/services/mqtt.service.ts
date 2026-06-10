import { Injectable, computed, signal } from '@angular/core';
import mqtt, { MqttClient } from 'mqtt';
import { Subject } from 'rxjs';

import { environment } from '../../../environments/environment';
import { DebugShotEvent, RawDebugShotPayload } from '../models/debug-shot-event.model';
import { hoopFromRaw, RawShotPayload, ShotEvent } from '../models/shot-event.model';

/** Topic the shot-sensor publishes made-shot events on. */
const SHOTS_TOPIC = 'basketball/shots';
/** Topic the sensor publishes per-shot diagnostics on while in debug mode. */
const DEBUG_SHOTS_TOPIC = 'basketball/debug/shots';
/** Topic the sensor replies to `getStatus` commands on (`{ uptime, mode }`). */
const RESPONSE_TOPIC = 'basketball/response';
/** Topic we publish commands (e.g. `getStatus`) to the sensor on. */
const CMD_TOPIC = 'basketball/cmd';

/** Command payload that asks the sensor to report its health. */
const GET_STATUS_CMD = JSON.stringify({ method: 'getStatus', args: {} });
/** Command payload that switches the sensor into debug (test) mode. */
const ENTER_DEBUG_CMD = JSON.stringify({ method: 'enterDebugMode', args: {} });
/** Command payload that switches the sensor back into production mode. */
const ENTER_PRODUCTION_CMD = JSON.stringify({ method: 'enterProductionMode', args: {} });

/** How often we ping the sensor for a health response while connected. */
const HEALTH_POLL_MS = 15_000;
/** With no health response inside this window, the sensor counts as offline. */
const HEALTH_TIMEOUT_MS = 20_000;

/**
 * End-to-end sensor status.
 *
 * `connected` means the broker link is up *and* the sensor has answered a
 * recent health check. `no-sensor` means the broker is reachable but the
 * sensor itself is silent. `connecting` covers both opening the broker link
 * and the initial wait for the first health response.
 */
export type MqttStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'no-sensor';

/** Tri-state for the sensor health-check, independent of the broker link. */
type SensorState = 'unknown' | 'online' | 'offline';

/**
 * Operating mode the sensor reports in its health reply. `debug` puts it into
 * test mode (where it streams per-shot diagnostics on `basketball/debug/shots`);
 * `production` is normal play. `unknown` means we haven't heard a mode yet (or
 * an older firmware that doesn't report one).
 */
export type SensorMode = 'debug' | 'production' | 'unknown';

/**
 * Owns the connection to the local MQTT broker and turns raw
 * `basketball/shots` messages into validated {@link ShotEvent}s.
 *
 * Beyond broker connectivity it actively health-checks the physical sensor:
 * it periodically publishes a `getStatus` command on `basketball/cmd` and
 * listens for an `{ uptime }` reply on `basketball/response`. The sensor is
 * only treated as live once such a reply arrives, so {@link status} reports
 * the true end-to-end health rather than just whether the broker is up.
 *
 * Browsers can only speak MQTT over WebSockets, so the broker URL in
 * `environment.mqttBrokerUrl` must be a `ws://` / `wss://` endpoint.
 *
 * Provided in root so a single connection is shared across the app.
 */
@Injectable({ providedIn: 'root' })
export class MqttService {
  private client: MqttClient | null = null;
  private pollId: ReturnType<typeof setTimeout> | null = null;
  private staleId: ReturnType<typeof setTimeout> | null = null;

  private readonly _brokerStatus = signal<'disconnected' | 'connecting' | 'connected' | 'error'>(
    'disconnected',
  );
  private readonly _sensorState = signal<SensorState>('unknown');
  private readonly _mode = signal<SensorMode>('unknown');

  /** Combined broker + sensor health, for status indicators and game gating. */
  readonly status = computed<MqttStatus>(() => {
    const broker = this._brokerStatus();
    if (broker !== 'connected') return broker; // disconnected | connecting | error
    switch (this._sensorState()) {
      case 'online':
        return 'connected';
      case 'offline':
        return 'no-sensor';
      default:
        return 'connecting'; // broker up, still waiting on the first reply
    }
  });

  /** The sensor's last-reported operating mode (`debug` / `production`). */
  readonly mode = this._mode.asReadonly();

  /** Emits one event per valid `basketball/shots` message received. */
  readonly shots$ = new Subject<ShotEvent>();

  /** Emits one event per valid `basketball/debug/shots` message (test mode). */
  readonly debugShots$ = new Subject<DebugShotEvent>();

  /** Open a connection to the broker and subscribe to the sensor topics. */
  connect(): void {
    if (this.client) return; // Already connected or connecting.

    this._brokerStatus.set('connecting');
    const client = mqtt.connect(environment.mqttBrokerUrl);
    this.client = client;

    client.on('connect', () => {
      this._brokerStatus.set('connected');
      client.subscribe([SHOTS_TOPIC, DEBUG_SHOTS_TOPIC, RESPONSE_TOPIC], (err) => {
        if (err) {
          console.error('MQTT: failed to subscribe to sensor topics:', err.message);
          this._brokerStatus.set('error');
          return;
        }
        this.startHealthChecks();
      });
    });

    client.on('message', (topic, payload) => {
      if (topic === SHOTS_TOPIC) {
        const event = this.parseShot(payload);
        if (event) this.shots$.next(event);
      } else if (topic === DEBUG_SHOTS_TOPIC) {
        const event = this.parseDebugShot(payload);
        if (event) this.debugShots$.next(event);
      } else if (topic === RESPONSE_TOPIC) {
        const reply = this.parseHealthReply(payload);
        if (reply) {
          this.markSensorOnline();
          this._mode.set(reply.mode);
        }
      }
    });

    // mqtt.js auto-retries on a dropped link; reflect that and stop pinging.
    client.on('reconnect', () => {
      this._brokerStatus.set('connecting');
      this.stopHealthChecks();
    });

    client.on('error', (err) => {
      console.error('MQTT: connection error:', err.message);
      this._brokerStatus.set('error');
      this.stopHealthChecks();
    });

    client.on('close', () => {
      this._brokerStatus.set('disconnected');
      this.stopHealthChecks();
    });
  }

  /** Ask the sensor to switch into debug (test) mode. */
  enterDebugMode(): void {
    this.client?.publish(CMD_TOPIC, ENTER_DEBUG_CMD);
  }

  /** Ask the sensor to switch back into production mode. */
  enterProductionMode(): void {
    this.client?.publish(CMD_TOPIC, ENTER_PRODUCTION_CMD);
  }

  /** Drop any existing connection and open a fresh one to the broker. */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  /** Close the broker connection. Safe to call when not connected. */
  disconnect(): void {
    this.stopHealthChecks();
    if (!this.client) return;
    this.client.end(true);
    this.client = null;
    this._brokerStatus.set('disconnected');
  }

  /** Begin pinging the sensor and watching for its replies. */
  private startHealthChecks(): void {
    this.stopHealthChecks();
    this._sensorState.set('unknown');
    this.requestStatus(); // Ask immediately, then only if replies go quiet.
    this.armStaleTimer();
    this.scheduleNextPoll();
  }

  /** Stop pinging the sensor and reset it to an unknown state. */
  private stopHealthChecks(): void {
    this.clearPollTimer();
    this.clearStaleTimer();
    this._sensorState.set('unknown');
    this._mode.set('unknown');
  }

  /**
   * Schedule the next `getStatus` for HEALTH_POLL_MS from now. Every received
   * reply reschedules this, so we only actually ping the sensor once it has
   * been quiet for longer than HEALTH_POLL_MS. If it stays quiet the poll
   * fires and re-arms itself, so we keep probing until it answers again.
   */
  private scheduleNextPoll(): void {
    this.clearPollTimer();
    this.pollId = setTimeout(() => {
      this.requestStatus();
      this.scheduleNextPoll();
    }, HEALTH_POLL_MS);
  }

  private clearPollTimer(): void {
    if (this.pollId !== null) {
      clearTimeout(this.pollId);
      this.pollId = null;
    }
  }

  /** Publish a `getStatus` command so the sensor reports its uptime. */
  private requestStatus(): void {
    this.client?.publish(CMD_TOPIC, GET_STATUS_CMD);
  }

  /**
   * A fresh health reply landed: the sensor is live. Reset both the staleness
   * clock and the poll timer, since hearing from the sensor means there's no
   * need to ask again for another HEALTH_POLL_MS.
   */
  private markSensorOnline(): void {
    this._sensorState.set('online');
    this.armStaleTimer();
    this.scheduleNextPoll();
  }

  /** (Re)start the timer that marks the sensor offline if replies stop. */
  private armStaleTimer(): void {
    this.clearStaleTimer();
    this.staleId = setTimeout(() => this._sensorState.set('offline'), HEALTH_TIMEOUT_MS);
  }

  private clearStaleTimer(): void {
    if (this.staleId !== null) {
      clearTimeout(this.staleId);
      this.staleId = null;
    }
  }

  /**
   * Parse a health reply, returning its operating mode, or null when the
   * payload isn't a valid `{ uptime: number }` reply. A reply without a (valid)
   * `mode` field still counts as healthy and reports `'unknown'`, so older
   * firmware that doesn't send a mode keeps the sensor marked online.
   */
  private parseHealthReply(payload: Uint8Array): { mode: SensorMode } | null {
    try {
      const reply = JSON.parse(payload.toString()) as { uptime?: unknown; mode?: unknown };
      if (typeof reply.uptime !== 'number') return null;
      const mode: SensorMode =
        reply.mode === 'debug' ? 'debug' : reply.mode === 'production' ? 'production' : 'unknown';
      return { mode };
    } catch {
      console.warn('MQTT: ignoring non-JSON sensor response');
      return null;
    }
  }

  /** Parse + validate a raw debug-shot payload, returning null if malformed. */
  private parseDebugShot(payload: Uint8Array): DebugShotEvent | null {
    let raw: Partial<RawDebugShotPayload>;
    try {
      raw = JSON.parse(payload.toString());
    } catch {
      console.warn('MQTT: ignoring non-JSON debug shot payload', payload.toString());
      return null;
    }

    if (
      typeof raw.hoop !== 'string' ||
      typeof raw.isShotMade !== 'boolean' ||
      !Array.isArray(raw.eventLog) ||
      !raw.eventLog.every((line) => typeof line === 'string')
    ) {
      console.warn('MQTT: ignoring malformed debug shot payload:', raw);
      return null;
    }
    return { hoop: raw.hoop, isShotMade: raw.isShotMade, eventLog: raw.eventLog };
  }

  /** Parse + validate a raw shot payload, returning null for malformed messages. */
  private parseShot(payload: Uint8Array): ShotEvent | null {
    let raw: Partial<RawShotPayload>;
    try {
      raw = JSON.parse(payload.toString());
    } catch {
      console.warn('MQTT: ignoring non-JSON shot payload');
      return null;
    }

    const hoop = hoopFromRaw(raw.hoop);
    if (hoop === null || typeof raw.ts !== 'number') {
      console.warn('MQTT: ignoring malformed shot payload:', raw);
      return null;
    }
    return { hoop, ts: raw.ts };
  }
}
