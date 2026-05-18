// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn } from 'node:child_process';

import type { ActionHandler } from '../../shared/plugin-types';

/**
 * Built-in key-combo action.
 *
 * Sends a keyboard chord to the active window. Today's implementation
 * shells out to `xdotool key`, which lives in every Linux distro's
 * repos and supports both modifier combinations (Ctrl+Shift+S) and
 * media keys (XF86AudioRaiseVolume).
 *
 * Wayland sessions need xwayland for xdotool to reach the focused
 * window. Native-Wayland equivalents (wtype, ydotool) land in
 * follow-up implementations once we abstract the key-emit behind
 * a per-display-server backend, mirroring the input.h abstraction
 * the daemon already uses.
 *
 * Config schema:
 *   keys (string, required): the xdotool-style chord, e.g.
 *     "alt+Tab", "ctrl+shift+s", "XF86AudioMute".
 */

const KEY_EMIT_BINARY = 'xdotool';

export const keyCombo: ActionHandler = async (config, ctx) => {
  const keys = typeof config.keys === 'string' ? config.keys.trim() : '';
  if (!keys) {
    ctx.log('key-combo invoked without "keys" config — nothing to send');
    return;
  }
  return new Promise<void>((resolve) => {
    const child = spawn(KEY_EMIT_BINARY, ['key', '--', keys], {
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      ctx.log(`key-combo: failed to spawn ${KEY_EMIT_BINARY}: ${err.message}`);
      resolve();
    });
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        ctx.log(`key-combo: ${KEY_EMIT_BINARY} exited with code ${code}`);
      }
      resolve();
    });
  });
};
