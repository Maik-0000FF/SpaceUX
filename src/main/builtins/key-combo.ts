// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ActionHandler } from '../../shared/plugin-types.js';

import { parseChord } from './keycodes.js';

/**
 * Built-in key-combo action.
 *
 * Sends a keyboard chord by asking the SpaceUX daemon to inject it
 * through its uinput device. uinput sits below the compositor in the
 * kernel input plumbing, so the events arrive at the focused window
 * exactly as physical hardware would — Wayland's per-client isolation
 * is bypassed and compositor-level shortcuts (Alt+Tab, Super, media
 * keys) work without per-DE backends.
 *
 * Prerequisites: the daemon must be running and have `/dev/uinput`
 * access (udev rule + input group). The daemon's hello event tells
 * the renderer whether injection is available; this handler stays
 * fail-soft when it isn't (logs and returns).
 *
 * Config schema:
 *   keys (string, required): symbolic chord like "alt+Tab",
 *     "ctrl+shift+s", "XF86AudioRaiseVolume". Case-insensitive;
 *     see keycodes.ts for the recognised names.
 */

export const keyCombo: ActionHandler = (config, ctx) => {
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
  ctx.injectChord(parsed.modifiers, parsed.key);
};
