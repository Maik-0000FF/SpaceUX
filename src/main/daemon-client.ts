// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { EventEmitter } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  Protocol,
  encodeCommand,
  isDaemonEvent,
  type DaemonCommand,
  type DaemonEvent,
} from '../shared/protocol.js';

/**
 * UNIX-socket client for the daemon.
 *
 * One instance per renderer process — the daemon multiplexes
 * multiple clients but each Electron window only needs one. Events
 * arrive as JSON-Lines; the client accumulates partial reads in a
 * buffer and emits a typed `event` for every complete line.
 *
 * Auto-reconnect: when the socket closes the client schedules a
 * reconnect after `reconnectDelayMs`. This matches the daemon's own
 * "device hot-plug" rhythm — clients should survive a daemon restart
 * without user intervention.
 */
export class DaemonClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private explicitlyClosed = false;
  /** Latched from the daemon's hello event. False before any hello
   *  arrives, true when the daemon reported /dev/uinput was reachable,
   *  false again after the socket closes — so callers that race the
   *  startup are treated the same as "no injection". */
  private injectAvailableFlag = false;

  constructor(
    private readonly socketPath: string = defaultSocketPath(),
    private readonly reconnectDelayMs = 1000,
  ) {
    super();
  }

  /** Start connecting. Idempotent — calling twice does nothing. */
  start(): void {
    if (this.socket || this.reconnectTimer) return;
    this.explicitlyClosed = false;
    this.openSocket();
  }

  /** Stop connecting and tear down the current socket. After stop()
   *  the client will not auto-reconnect; call start() again to resume. */
  stop(): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /** Send a typed command. No-op when the socket is not yet connected
   *  — subscribing before connection is a common race that should not
   *  throw. Re-subscribe on the 'connected' event if you care about
   *  zero-loss. */
  send(cmd: DaemonCommand): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(encodeCommand(cmd));
  }

  /** Convenience: subscribe to both event streams in one round-trip. */
  subscribeAll(): void {
    this.send({ kind: 'subscribe', events: ['axes', 'buttons'] });
  }

  /** Inject a modifier+key chord through the daemon's uinput device.
   *  No-op when the socket is not yet connected — same fail-soft
   *  behaviour as `send()`. The daemon further no-ops the command if
   *  /dev/uinput was unavailable at startup, so the caller never
   *  has to guard the two failure modes separately. */
  injectChord(modifiers: number[], key: number): void {
    this.send({ kind: 'inject-chord', modifiers, key });
  }

  /** Last value the daemon reported in its hello event. Plugins use
   *  this to decide whether to log a "key injection unavailable"
   *  hint instead of dropping a chord silently. */
  isInjectAvailable(): boolean {
    return this.injectAvailableFlag;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private openSocket(): void {
    const sock = net.createConnection(this.socketPath);
    this.socket = sock;
    this.buffer = '';

    sock.on('connect', () => {
      this.emit('connected');
    });

    sock.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      this.drainLines();
    });

    sock.on('error', (err: Error) => {
      this.emit('error', err);
    });

    sock.on('close', () => {
      this.socket = null;
      this.injectAvailableFlag = false;
      this.emit('disconnected');
      if (!this.explicitlyClosed) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.openSocket();
        }, this.reconnectDelayMs);
      }
    });
  }

  /**
   * Pull complete newline-terminated JSON objects out of the buffer.
   * The daemon emits one JSON line per event; if a network read
   * splits across a newline we keep the partial line in the buffer
   * and resume on the next chunk.
   */
  private drainLines(): void {
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // The daemon also emits a bare "PONG\n" for PING. Anything that
      // is not valid JSON gets ignored — the protocol guarantees JSON
      // for every other event.
      return;
    }
    if (!isDaemonEvent(parsed)) return;
    const evt = parsed as DaemonEvent;
    // Latch hello fields the rest of the app might read off the
    // client object instead of subscribing to every event.
    if (evt.event === 'hello') {
      this.injectAvailableFlag = evt.inject === true;
    }
    this.emit('event', evt);
  }
}

/** Default UNIX socket path. Mirrors `platform_socket_path()` in
 *  `src/daemon/platform_linux.c`: prefer `$XDG_RUNTIME_DIR` when set
 *  (containerised / unusual sessions override the systemd default),
 *  fall back to `/run/user/<uid>/`. Drift between the two would mean
 *  the daemon writes to one path while the client polls another. */
export function defaultSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
  if (runtimeDir && runtimeDir.startsWith('/')) {
    return path.join(runtimeDir, 'spaceux.sock');
  }
  // On Linux os.userInfo().uid matches getuid(). On systems where this
  // is unavailable (e.g. a hypothetical Windows port) we fall back to
  // a path under the user's home directory.
  const info = os.userInfo();
  const uid = typeof info.uid === 'number' && info.uid >= 0 ? info.uid : null;
  if (uid !== null) {
    return `/run/user/${uid}/spaceux.sock`;
  }
  return path.join(os.tmpdir(), `spaceux-${info.username}.sock`);
}

// Re-export the protocol VERSION so callers don't have to import from
// two places when negotiating compatibility.
export const PROTOCOL_VERSION = Protocol.VERSION;
