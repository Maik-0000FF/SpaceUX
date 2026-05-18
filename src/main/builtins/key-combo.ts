// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn } from 'node:child_process';
import os from 'node:os';

import type { ActionHandler } from '../../shared/plugin-types.js';

import { parseChord } from './keycodes.js';

/**
 * Built-in key-combo action.
 *
 * Sends a keyboard chord to the active window via `ydotool`. ydotool
 * injects events at the uinput layer — *below* the display server —
 * so it works on Wayland compositors (KDE Plasma, GNOME, sway, …)
 * including compositor-level shortcuts like Alt+Tab that wtype /
 * wlroots-virtual-keyboard can't reach.
 *
 * Prerequisite for users: the `ydotoold` daemon must be running (Arch
 * ships a systemd unit, enable + start it once). Without ydotoold the
 * spawned ydotool exits with an error which gets logged via the
 * action context; the action is otherwise harmless.
 *
 * Config schema:
 *   keys (string, required): symbolic chord like "alt+Tab",
 *     "ctrl+shift+s", "XF86AudioRaiseVolume". Case-insensitive;
 *     see keycodes.ts for the recognised names.
 *
 * Wire-up choice: ydotool's `key` subcommand wants Linux keycodes
 * in `<code>:<state>` notation. We translate the user's symbolic
 * spec into the numeric form here so the on-disk config stays
 * readable.
 */

const YDOTOOL_BINARY = 'ydotool';

/**
 * Resolve the ydotoold control socket path. Honours the user's
 * YDOTOOL_SOCKET override, then falls back to the Arch / Debian
 * user-systemd convention of $XDG_RUNTIME_DIR/.ydotool_socket which
 * matches where `systemctl --user start ydotool` parks it. We
 * compute the default ourselves rather than trusting the env we
 * inherit from Electron's launch context — Electron started from
 * a .desktop entry or autostart often loses XDG_RUNTIME_DIR.
 */
function ydotoolSocketPath(): string {
  const explicit = process.env.YDOTOOL_SOCKET?.trim();
  if (explicit) return explicit;
  const runtime = process.env.XDG_RUNTIME_DIR?.trim();
  if (runtime) return `${runtime}/.ydotool_socket`;
  const uid = os.userInfo().uid;
  if (typeof uid === 'number' && uid >= 0) return `/run/user/${uid}/.ydotool_socket`;
  return '/tmp/.ydotool_socket';
}

export const keyCombo: ActionHandler = async (config, ctx) => {
  const keys = typeof config.keys === 'string' ? config.keys.trim() : '';
  if (!keys) {
    ctx.log('key-combo invoked without "keys" config — nothing to send');
    return;
  }
  const parsed = parseChord(keys);
  if (!parsed) {
    ctx.log(`key-combo: unrecognised chord "${keys}" — see src/main/builtins/keycodes.ts`);
    return;
  }

  // ydotool sequence: every modifier down → end key down → end key up
  // → every modifier up in reverse order. This matches what a human
  // does when typing a chord, and avoids the compositor seeing the
  // end key alone before the modifier state has settled.
  const args = ['key'];
  for (const m of parsed.modifiers) args.push(`${m}:1`);
  args.push(`${parsed.key}:1`);
  args.push(`${parsed.key}:0`);
  for (let i = parsed.modifiers.length - 1; i >= 0; i--) {
    args.push(`${parsed.modifiers[i]}:0`);
  }

  return new Promise<void>((resolve) => {
    const child = spawn(YDOTOOL_BINARY, args, {
      stdio: 'ignore',
      env: { ...process.env, YDOTOOL_SOCKET: ydotoolSocketPath() },
    });
    child.on('error', (err) => {
      ctx.log(`key-combo: failed to spawn ${YDOTOOL_BINARY}: ${err.message}`);
      resolve();
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        ctx.log(`key-combo: ${YDOTOOL_BINARY} exited with code ${code}`);
      }
      resolve();
    });
  });
};
