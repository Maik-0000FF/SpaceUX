// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describeError } from '../shared/errors.js';

import { IPC_TIMEOUT_MS } from './compositor-ipc.js';
import { KWinCursorService } from './kwin-cursor.js';

/**
 * A source of the global pointer position, abstracted over the compositor
 * (#507). The pie opens by anchoring a small layer-shell surface so its centre
 * lands on the cursor, which means the position has to be known *before* the
 * surface is shown; a small surface cannot observe the global cursor itself.
 *
 * Each compositor exposes the cursor differently and none of it is a portable
 * Wayland client API (clients may not query the global pointer), so this
 * interface lets the runtime pick a backend per desktop while the open path
 * stays compositor-agnostic. A backend that cannot answer returns `null`, and
 * the caller decides what to do (today: skip the open).
 */
export interface CursorSource {
  /** The global desktop pixel of the pointer, or `null` when this backend
   *  cannot provide it (wrong compositor, query failed, timed out). Never
   *  throws: a failure is reported as `null` so one missing open is not fatal. */
  getCursor(): Promise<{ x: number; y: number } | null>;
}

/**
 * KDE Wayland: round-trips through a KWin script over D-Bus (see
 * {@link KWinCursorService}). Initialised lazily on the first open and left
 * disabled after a failed init, so a non-KDE host degrades to `null` rather
 * than retrying the D-Bus dance on every open.
 */
class KWinCursorSource implements CursorSource {
  private service: KWinCursorService | null = null;
  private tried = false;

  constructor(private readonly scriptDir: string) {}

  async getCursor(): Promise<{ x: number; y: number } | null> {
    if (!this.tried) {
      this.tried = true;
      const service = new KWinCursorService(this.scriptDir);
      try {
        await service.init();
        this.service = service;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[cursor] KWin cursor service unavailable: ${describeError(err)}`);
      }
    }
    if (this.service === null) return null;
    try {
      return await this.service.getCursor();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[cursor] KWin script failed: ${describeError(err)}`);
      return null;
    }
  }
}

const execFileAsync = promisify(execFile);

/** Parse a `{"x":<num>,"y":<num>,...}` payload into a rounded global pixel, or
 *  `null` when it is not that shape. Shared by the mango (`mmsg get cursorpos`)
 *  and Hyprland (`hyprctl cursorpos -j`) backends, which both emit the pointer
 *  in the global layout space the overlay's SetCursorPosition expects, possibly
 *  fractional, hence the rounding. Pure, so it is unit-tested without a
 *  compositor. */
export function parseXyJson(stdout: string): { x: number; y: number } | null {
  let parsed: { x?: unknown; y?: unknown };
  try {
    parsed = JSON.parse(stdout) as { x?: unknown; y?: unknown };
  } catch {
    return null;
  }
  const { x, y } = parsed;
  if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
    return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}

/**
 * mango (and other dwl-derived wlroots compositors with the same IPC): asks the
 * compositor for the pointer position via `mmsg get cursorpos`. mango ships
 * `mmsg` and sets MANGO_INSTANCE_SIGNATURE for it to find the IPC socket.
 */
class MangoCursorSource implements CursorSource {
  async getCursor(): Promise<{ x: number; y: number } | null> {
    try {
      const { stdout } = await execFileAsync('mmsg', ['get', 'cursorpos'], {
        timeout: IPC_TIMEOUT_MS,
      });
      const pos = parseXyJson(stdout);
      if (pos === null) {
        // eslint-disable-next-line no-console
        console.warn(`[cursor] mango cursorpos: unexpected payload ${stdout.trim()}`);
      }
      return pos;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[cursor] mango cursorpos failed: ${describeError(err)}`);
      return null;
    }
  }
}

/**
 * Hyprland: asks for the pointer position via `hyprctl cursorpos -j`, which
 * prints `{"x":<num>,"y":<num>}` in global layout pixels, the same shape mango
 * emits, so the shared parser handles both.
 */
class HyprlandCursorSource implements CursorSource {
  async getCursor(): Promise<{ x: number; y: number } | null> {
    try {
      const { stdout } = await execFileAsync('hyprctl', ['cursorpos', '-j'], {
        timeout: IPC_TIMEOUT_MS,
      });
      const pos = parseXyJson(stdout);
      if (pos === null) {
        // eslint-disable-next-line no-console
        console.warn(`[cursor] hyprland cursorpos: unexpected payload ${stdout.trim()}`);
      }
      return pos;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[cursor] hyprland cursorpos failed: ${describeError(err)}`);
      return null;
    }
  }
}

/** A backend for a compositor with no known cursor query: always `null`, so the
 *  caller skips the open (the pre-existing behaviour on unsupported desktops).
 *  Replaced by a centre/corner position mode later (#63). */
class NullCursorSource implements CursorSource {
  getCursor(): Promise<{ x: number; y: number } | null> {
    return Promise.resolve(null);
  }
}

/** Options the concrete backends need; only the KWin one uses a script dir. */
export interface CursorSourceOptions {
  /** Directory where the KWin helper script is materialised (an XDG state dir). */
  kwinScriptDir: string;
}

/**
 * Pick the cursor backend for the running desktop. `desktop` is the normalised
 * id from {@link readHostEnvironment} (`kde`, `hyprland`, `mango`, ...). KDE keeps
 * its KWin path untouched; Hyprland and mango use their IPC; anything else gets
 * the null backend until a position-mode fallback lands (#63). The CLI backends
 * use tools on PATH, so the same code runs across distros (Arch, Debian, NixOS).
 */
export function createCursorSource(desktop: string, opts: CursorSourceOptions): CursorSource {
  switch (desktop) {
    case 'kde':
      return new KWinCursorSource(opts.kwinScriptDir);
    case 'hyprland':
      return new HyprlandCursorSource();
    case 'mango':
      return new MangoCursorSource();
    default:
      return new NullCursorSource();
  }
}
