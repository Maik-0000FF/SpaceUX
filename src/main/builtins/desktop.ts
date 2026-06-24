// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ActionHandler } from '../../shared/plugin-types.js';

import { createSystemControlBackend } from '../system-control.js';

/**
 * Built-in desktop-control action: a semantic `op` (volume / mute / brightness)
 * that the host resolves per compositor, so the default menu's controls work on
 * KDE, Hyprland and mango without per-compositor key binds. KDE injects the media
 * key (Plasma OSD); wlroots uses wpctl (volume) and brightnessctl (brightness).
 * Fail-soft: an unknown op logs and no-ops.
 *
 * Config schema:
 *   op (string, required): "volume-up" | "volume-down" | "mute" |
 *     "brightness-up" | "brightness-down".
 */
export const desktopAction: ActionHandler = async (config, ctx) => {
  const op = typeof config.op === 'string' ? config.op : '';
  const backend = createSystemControlBackend(ctx.host.environment.desktop, {
    injectChord: ctx.injectChord,
    injectAvailable: ctx.injectAvailable,
  });
  switch (op) {
    case 'volume-up':
      await backend.adjustVolume(1);
      break;
    case 'volume-down':
      await backend.adjustVolume(-1);
      break;
    case 'mute':
      await backend.toggleMute();
      break;
    case 'brightness-up':
      await backend.adjustBrightness(1);
      break;
    case 'brightness-down':
      await backend.adjustBrightness(-1);
      break;
    default:
      ctx.log(`desktop: unknown op "${op}"`);
      break;
  }
};
