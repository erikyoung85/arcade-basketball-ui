import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

import { environment } from '../../../environments/environment';
import { DebugShotEvent, RawDebugShotPayload } from '../models/debug-shot-event.model';
import { hoopFromRaw, RawShotPayload, ShotEvent } from '../models/shot-event.model';

/** Command that asks the sensor to report its health (`{ uptime, mode }`). */
const GET_STATUS_CMD = JSON.stringify({ method: 'getStatus', args: {} });
/** Command that switches the sensor into debug (test) mode. */
const ENTER_DEBUG_CMD = JSON.stringify({ method: 'enterDebugMode', args: {} });
/** Command that switches the sensor back into production mode. */
const ENTER_PRODUCTION_CMD = JSON.stringify({ method: 'enterProductionMode', args: {} });

/** First reconnect delay; doubles each attempt up to {@link RECONNECT_MAX_MS}. */
const RECONNECT_BASE_MS = 1_000;
/** Ceiling on the reconnect backoff so we keep retrying at a steady cadence. */
const RECONNECT_MAX_MS = 15_000;

/**
 * How often we ping the sensor with `getStatus` while connected. A TCP socket
 * can stay "open" long after the peer has vanished (power cut, Wi-Fi drop), so
 * we provoke regular traffic to prove the link is really alive.
 */
const HEARTBEAT_INTERVAL_MS = 4_000;
/**
 * With no inbound message (a `getStatus` reply, a shot — anything) for this
 * long, the link is treated as dead and torn down so we reconnect. Must be a
 * comfortable multiple of {@link HEARTBEAT_INTERVAL_MS} so brief jitter or a
 * single dropped ping doesn't trip a false reconnect.
 */
const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * WebSocket connection status, which now stands in for sensor health: the
 * sensors are only reachable when the socket is `connected`. `error` covers a
 * dropped/failed link that we're retrying in the background; `connecting`
 * covers the initial open and each retry attempt.
 */
export type SensorStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Operating mode the sensor reports in its health reply. `debug` puts it into
 * test mode (where it streams per-shot diagnostics); `production` is normal
 * play. `unknown` means we haven't heard a mode yet (or older firmware that
 * doesn't report one).
 */
export type SensorMode = 'debug' | 'production' | 'unknown';

/**
 * Owns the direct WebSocket connection to the arcade hoop sensors and turns the
 * raw messages they push into validated {@link ShotEvent}s.
 *
 * There is no broker in between: the app connects straight to the sensors'
 * WebSocket server, so the socket's own connection state *is* the sensor
 * health. Because a dead peer can leave the socket wedged "open", we run a
 * `getStatus` heartbeat while connected: if no message comes back within
 * {@link HEARTBEAT_TIMEOUT_MS} the link is declared dead, torn down, and
 * reconnected (with capped exponential backoff). The same heartbeat replies
 * keep the reported {@link mode} fresh.
 *
 * Provided in root so a single connection is shared across the app.
 */
@Injectable({ providedIn: 'root' })
export class SensorService {
  private socket: WebSocket | null = null;
  private reconnectId: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** Recurring `getStatus` ping while connected; null when not connected. */
  private heartbeatId: ReturnType<typeof setInterval> | null = null;
  /** Fires when replies have gone quiet too long, declaring the link dead. */
  private staleId: ReturnType<typeof setTimeout> | null = null;
  /** True while the app wants a live link; gates whether we auto-reconnect. */
  private wantConnection = false;

  private readonly _status = signal<SensorStatus>('disconnected');
  private readonly _mode = signal<SensorMode>('unknown');

  /** Live WebSocket connection status, for status indicators and game gating. */
  readonly status = this._status.asReadonly();

  /** The sensor's last-reported operating mode (`debug` / `production`). */
  readonly mode = this._mode.asReadonly();

  /** Emits one event per valid made-shot message received. */
  readonly shots$ = new Subject<ShotEvent>();

  /** Emits one event per valid debug-shot message (test mode). */
  readonly debugShots$ = new Subject<DebugShotEvent>();

  /** Open the WebSocket to the sensors. Safe to call when already connected. */
  connect(): void {
    this.wantConnection = true;
    if (this.socket) return; // Already connected or connecting.
    this.openSocket();
  }

  /** Ask the sensor to switch into debug (test) mode. */
  enterDebugMode(): void {
    this.send(ENTER_DEBUG_CMD);
    // Reflect the requested mode immediately so the UI follows without waiting
    // on a reply; a pushed status message will reconcile if it differs.
    this._mode.set('debug');
  }

  /** Ask the sensor to switch back into production mode. */
  enterProductionMode(): void {
    this.send(ENTER_PRODUCTION_CMD);
    this._mode.set('production');
  }

  /** Drop the current link and open a fresh one, resetting the backoff. */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  /** Close the connection and stop reconnecting. Safe to call when not open. */
  disconnect(): void {
    this.wantConnection = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.reconnectAttempts = 0;
    this._mode.set('unknown');

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      // Detach handlers first so the close we trigger doesn't drive a reconnect.
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
    this._status.set('disconnected');
  }

  /** Open a socket and wire up its lifecycle handlers. */
  private openSocket(): void {
    this.clearReconnectTimer();
    this._status.set('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(environment.sensorWebSocketUrl);
    } catch (err) {
      console.error('Sensor: failed to open WebSocket:', err);
      this._status.set('error');
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this._status.set('connected');
      // Begin the heartbeat: its first ping also fetches the current mode.
      this.startHeartbeat();
    };

    socket.onmessage = (event) => {
      // Any inbound frame proves the link is alive — reset the staleness clock.
      this.armStaleTimer();
      this.handleMessage(event.data);
    };

    // The browser fires `error` and then `close`; let `close` drive the
    // reconnect so we never schedule it twice.
    socket.onerror = () => this._status.set('error');

    socket.onclose = () => {
      this.socket = null;
      this.onLinkDown();
    };
  }

  /**
   * Common teardown when the link goes down — whether the browser reported the
   * close or our heartbeat declared it dead. Stops the heartbeat and either
   * reconnects (if we still want a link) or settles into `disconnected`.
   */
  private onLinkDown(): void {
    this.stopHeartbeat();
    this._mode.set('unknown');
    if (this.wantConnection) {
      this._status.set('error');
      this.scheduleReconnect();
    } else {
      this._status.set('disconnected');
    }
  }

  /**
   * The heartbeat went unanswered: the socket looks open but the peer is gone.
   * Force it down and reconnect rather than waiting on a TCP close that may
   * never come.
   */
  private handleStaleConnection(): void {
    console.warn('Sensor: heartbeat timed out; forcing reconnect');
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      // Detach handlers so the eventual close on this dead socket is a no-op.
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* already closing/closed */
      }
    }
    this.onLinkDown();
  }

  /** Start pinging `getStatus` and arm the staleness deadline. */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.send(GET_STATUS_CMD); // Immediate ping — also fetches the initial mode.
    this.armStaleTimer();
    this.heartbeatId = setInterval(() => this.send(GET_STATUS_CMD), HEARTBEAT_INTERVAL_MS);
  }

  /** Stop the heartbeat and clear its staleness deadline. */
  private stopHeartbeat(): void {
    if (this.heartbeatId !== null) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
    this.clearStaleTimer();
  }

  /** (Re)start the timer that declares the link dead if replies stop. */
  private armStaleTimer(): void {
    if (this.socket === null) return; // Only meaningful with a live socket.
    this.clearStaleTimer();
    this.staleId = setTimeout(() => this.handleStaleConnection(), HEARTBEAT_TIMEOUT_MS);
  }

  private clearStaleTimer(): void {
    if (this.staleId !== null) {
      clearTimeout(this.staleId);
      this.staleId = null;
    }
  }

  /** Queue another connect attempt with capped exponential backoff. */
  private scheduleReconnect(): void {
    if (!this.wantConnection) return;
    this.clearReconnectTimer();
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectId = setTimeout(() => this.openSocket(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectId !== null) {
      clearTimeout(this.reconnectId);
      this.reconnectId = null;
    }
  }

  /** Send a command if the socket is open; otherwise quietly drop it. */
  private send(data: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  /**
   * Route an incoming message. Without MQTT topics to separate them, the kind
   * of message is identified by its payload shape: status replies carry an
   * `uptime`, debug-shots carry an `isShotMade`, and everything else is treated
   * as a made-shot event.
   */
  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return; // The sensor sends JSON text frames.

    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      console.warn('Sensor: ignoring non-JSON message:', data);
      return;
    }
    if (!raw || typeof raw !== 'object') {
      console.warn('Sensor: ignoring non-object message:', raw);
      return;
    }
    const msg = raw as Record<string, unknown>;

    if (typeof msg['uptime'] === 'number') {
      this._mode.set(this.parseMode(msg['mode']));
      return;
    }
    if (typeof msg['isShotMade'] === 'boolean') {
      const event = this.parseDebugShot(msg);
      if (event) this.debugShots$.next(event);
      return;
    }
    const shot = this.parseShot(msg);
    if (shot) this.shots$.next(shot);
  }

  /** Normalise the `mode` field of a health reply, defaulting to `unknown`. */
  private parseMode(mode: unknown): SensorMode {
    return mode === 'debug' ? 'debug' : mode === 'production' ? 'production' : 'unknown';
  }

  /** Validate a debug-shot payload, returning null if malformed. */
  private parseDebugShot(raw: Record<string, unknown>): DebugShotEvent | null {
    const { hoop, isShotMade, eventLog } = raw as Partial<RawDebugShotPayload>;
    if (
      typeof hoop !== 'string' ||
      typeof isShotMade !== 'boolean' ||
      !Array.isArray(eventLog) ||
      !eventLog.every((line) => typeof line === 'string')
    ) {
      console.warn('Sensor: ignoring malformed debug shot payload:', raw);
      return null;
    }
    return { hoop, isShotMade, eventLog };
  }

  /** Validate a made-shot payload, returning null for malformed messages. */
  private parseShot(raw: Record<string, unknown>): ShotEvent | null {
    const { hoop: rawHoop, ts } = raw as Partial<RawShotPayload>;
    const hoop = hoopFromRaw(rawHoop);
    if (hoop === null || typeof ts !== 'number') {
      console.warn('Sensor: ignoring malformed shot payload:', raw);
      return null;
    }
    return { hoop, ts };
  }
}
