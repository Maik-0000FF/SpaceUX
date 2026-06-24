// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Client for the native overlay daemon `spaceux-overlay` (#296 P2b): spawns
 * the binary if it isn't already up and drives it over the session bus
 * (interface `org.spaceux.Overlay1`). The SpaceUX main process owns this; it
 * computes the scene (see src/core/overlay-scene) and pushes it here.
 *
 * Only dbus-next + child_process: the binary
 * path is injected so the module can be exercised standalone, and the
 * lifecycle stays testable.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import dbus from 'dbus-next';

import type { OverlaySvgScene } from '../core/overlay-svg';

const SERVICE = 'org.spaceux.Overlay';
const OBJECT_PATH = '/org/spaceux/Overlay';
const INTERFACE = 'org.spaceux.Overlay1';

/** The org.spaceux.Overlay1 methods, as dbus-next exposes them on the proxy
 *  interface (members are dynamic, so we assert this shape once). */
type OverlayMethods = {
  Show(): Promise<void>;
  Hide(): Promise<void>;
  Quit(): Promise<void>;
  SetCursorPosition(x: number, y: number): Promise<void>;
  SetScene(json: string): Promise<void>;
  SetTheme(json: string): Promise<void>;
  SetSurfaceSize(px: number): Promise<void>;
};

type OverlayInterface = dbus.ClientInterface & OverlayMethods;

export type OverlayClientOptions = {
  /** Absolute path to the spaceux-overlay binary (caller resolves it). */
  binaryPath: string;
  /** Pointer events the surface reports back (pie-local pixels). */
  onPointerMoved?: (x: number, y: number) => void;
  onPointerPressed?: (x: number, y: number) => void;
  /** The daemon asked to close (e.g. compositor dismissed it). */
  onClosed?: () => void;
  /** Optional logger; defaults to console. */
  log?: (message: string) => void;
};

export class OverlayClient {
  private proc: ChildProcess | null = null;
  private bus: dbus.MessageBus | null = null;
  private iface: OverlayInterface | null = null;
  private readonly opts: OverlayClientOptions;

  constructor(opts: OverlayClientOptions) {
    this.opts = opts;
  }

  /** Connect to a running daemon, or spawn one and then connect. Idempotent:
   *  a second call while connected is a no-op. */
  async start(): Promise<void> {
    if (this.iface !== null) return;
    this.bus = dbus.sessionBus();
    try {
      // Already running (manually launched or bus-activated)?
      await this.connect();
    } catch {
      try {
        this.spawnDaemon();
        await this.connectWithRetry();
      } catch (err) {
        // Spawn/connect failed: release the bus and reap the child so a
        // later start() doesn't leak the old connection/process.
        await this.stop();
        throw err;
      }
    }
  }

  async show(): Promise<void> {
    await this.iface?.Show();
  }
  async hide(): Promise<void> {
    await this.iface?.Hide();
  }
  async setCursorPosition(x: number, y: number): Promise<void> {
    await this.iface?.SetCursorPosition(Math.round(x), Math.round(y));
  }
  async setScene(scene: OverlaySvgScene): Promise<void> {
    await this.iface?.SetScene(JSON.stringify(scene));
  }
  async setSurfaceSize(px: number): Promise<void> {
    await this.iface?.SetSurfaceSize(Math.round(px));
  }
  async setTheme(theme: unknown): Promise<void> {
    await this.iface?.SetTheme(JSON.stringify(theme));
  }

  /** Drop the bus and, only if we spawned the daemon, quit + reap it. A
   *  daemon we merely attached to (manual launch / bus activation) may be
   *  shared, so it is left running. Safe to call when never started. */
  async stop(): Promise<void> {
    if (this.proc !== null) {
      try {
        await this.iface?.Quit();
      } catch {
        // already gone; the kill below is the backstop
      }
    }
    this.iface = null;
    this.bus?.disconnect();
    this.bus = null;
    if (this.proc !== null && this.proc.exitCode === null) {
      this.proc.kill();
    }
    this.proc = null;
  }

  private spawnDaemon(): void {
    this.log(`spawning overlay daemon: ${this.opts.binaryPath}`);
    this.proc = spawn(this.opts.binaryPath, [], {
      stdio: ['ignore', 'ignore', 'pipe'],
      // Opt the spawned daemon into dying with us (PR_SET_PDEATHSIG): a
      // standalone / manual launch omits this and keeps running until quit.
      env: { ...process.env, SPACEUX_OVERLAY_DIE_WITH_PARENT: '1' },
    });
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd();
      if (text.length > 0) this.log(`daemon: ${text}`);
    });
    this.proc.on('error', (err) => this.log(`overlay daemon spawn error: ${err.message}`));
    this.proc.on('exit', (code) => {
      this.log(`overlay daemon exited (code ${code ?? 'null'})`);
      this.proc = null;
    });
  }

  private async connect(): Promise<void> {
    if (this.bus === null) throw new Error('bus not initialised');
    const obj = await this.bus.getProxyObject(SERVICE, OBJECT_PATH);
    const iface = obj.getInterface(INTERFACE) as OverlayInterface;
    iface.on('PointerMoved', (x: number, y: number) => this.opts.onPointerMoved?.(x, y));
    iface.on('PointerPressed', (x: number, y: number) => this.opts.onPointerPressed?.(x, y));
    iface.on('Closed', () => this.opts.onClosed?.());
    this.iface = iface;
  }

  /** Retry the connect for a couple of seconds while the freshly-spawned
   *  daemon registers its bus name. */
  private async connectWithRetry(attempts = 30, delayMs = 100): Promise<void> {
    for (let i = 0; i < attempts; i += 1) {
      try {
        await this.connect();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error('overlay daemon did not register on the session bus');
  }

  private log(message: string): void {
    // eslint-disable-next-line no-console
    (this.opts.log ?? ((m) => console.log(`[overlay] ${m}`)))(message);
  }
}
