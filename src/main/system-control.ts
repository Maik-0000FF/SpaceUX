// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describeError } from '../shared/errors.js';

import { IPC_TIMEOUT_MS } from './compositor-ipc.js';

const execFileAsync = promisify(execFile);

/**
 * System controls (volume, brightness) for desktop mode (#199), resolved per
 * compositor (#507) by {@link createSystemControlBackend}. KDE drives the media
 * keys so Plasma's own OSD reacts exactly as a keyboard key would (unchanged
 * from the historical inject path); every wlroots compositor (mango, Hyprland,
 * ...) drives the system CLIs (wpctl for volume, brightnessctl for brightness),
 * so they work without the compositor binding the media keys. Both paths are
 * fail-soft, and the sign is decided in the shared core before the split, so the
 * direction is identical on every compositor.
 *
 * Both the pie-menu `desktop` action and the desktop-mode axes consume this, so
 * the behaviour is identical however the user triggers it.
 */

/** Percent change per volume step (one media-key tap on KDE, one wpctl step on
 *  wlroots). Named so the feel is tuned in one place. */
export const VOLUME_STEP_PERCENT = 5;

/** Percent change per brightness step (one media-key tap on KDE, one
 *  brightnessctl step on wlroots). */
export const BRIGHTNESS_STEP_PERCENT = 5;

/** Upper bound wpctl is told to clamp the volume to (1.0 = 100%), so repeated
 *  raises can't push PipeWire into >100% clipping. Matches KDE's media-key cap
 *  instead of letting wlroots drift louder than KDE would. */
const VOLUME_MAX = 1.0;

/** Floor (percent of max) the brightness never drops below, passed to
 *  brightnessctl's `--min-value=`, so repeated lowers can't reach 0 and black
 *  out the screen with no way to dial it back up. KDE's media key caps above 0
 *  too. */
const BRIGHTNESS_MIN_PERCENT = 5;

// Linux input-event-codes for the media keys the KDE (inject) backend sends.
const KEY_VOLUMEUP = 115;
const KEY_VOLUMEDOWN = 114;
const KEY_MUTE = 113;
const KEY_BRIGHTNESSUP = 225;
const KEY_BRIGHTNESSDOWN = 224;

/** The PipeWire default sink, the wpctl target for the wlroots backend. */
const PIPEWIRE_SINK = '@DEFAULT_AUDIO_SINK@';

export interface SystemControlBackend {
  /** Raise (steps > 0) or lower (steps < 0) the volume by |steps| steps; a zero
   *  is a no-op. */
  adjustVolume: (steps: number) => Promise<void>;
  /** Toggle mute on the default output. */
  toggleMute: () => Promise<void>;
  /** Raise (steps > 0) or lower (steps < 0) the display brightness by |steps|
   *  steps; a zero is a no-op. */
  adjustBrightness: (steps: number) => Promise<void>;
}

/** The inject capability the KDE backend needs (the daemon's uinput path). */
export interface SystemControlDeps {
  injectChord: (modifiers: number[], key: number) => void;
  injectAvailable: () => boolean;
}

/** The `<n>%+`/`<n>%-` relative argument for `steps` of `stepPercent` each, the
 *  shape both wpctl (set-volume) and brightnessctl (set) accept, or null for a
 *  zero step. Pure, so it is unit-tested without spawning a tool. */
export function percentStepArg(steps: number, stepPercent: number): string | null {
  if (steps === 0) return null;
  return `${Math.abs(steps) * stepPercent}%${steps > 0 ? '+' : '-'}`;
}

/** KDE: media-key injection (Plasma OSD reacts as for a keyboard key). */
function createInjectSystemControl(deps: SystemControlDeps): SystemControlBackend {
  const tap = (key: number, times: number): void => {
    if (!deps.injectAvailable()) {
      // eslint-disable-next-line no-console
      console.warn('[system-control] injection unavailable; key dropped');
      return;
    }
    for (let i = 0; i < times; i += 1) deps.injectChord([], key);
  };
  return {
    adjustVolume: (steps) => {
      tap(steps >= 0 ? KEY_VOLUMEUP : KEY_VOLUMEDOWN, Math.abs(steps));
      return Promise.resolve();
    },
    toggleMute: () => {
      tap(KEY_MUTE, 1);
      return Promise.resolve();
    },
    adjustBrightness: (steps) => {
      tap(steps >= 0 ? KEY_BRIGHTNESSUP : KEY_BRIGHTNESSDOWN, Math.abs(steps));
      return Promise.resolve();
    },
  };
}

/** wlroots: wpctl (PipeWire) for volume, brightnessctl for brightness. Fail-soft:
 *  a missing tool / unsupported host logs and no-ops rather than erroring. */
function createWlrootsSystemControl(): SystemControlBackend {
  const run = async (cmd: string, args: string[]): Promise<void> => {
    try {
      await execFileAsync(cmd, args, { timeout: IPC_TIMEOUT_MS });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[system-control] ${cmd} ${args.join(' ')} failed: ${describeError(err)}`);
    }
  };
  return {
    adjustVolume: (steps) => {
      const arg = percentStepArg(steps, VOLUME_STEP_PERCENT);
      // `-l VOLUME_MAX` clamps the result so repeated raises stop at 100% rather
      // than clipping, matching KDE's media-key cap.
      return arg === null
        ? Promise.resolve()
        : run('wpctl', ['set-volume', '-l', String(VOLUME_MAX), PIPEWIRE_SINK, arg]);
    },
    toggleMute: () => run('wpctl', ['set-mute', PIPEWIRE_SINK, 'toggle']),
    adjustBrightness: (steps) => {
      const arg = percentStepArg(steps, BRIGHTNESS_STEP_PERCENT);
      // `--class=backlight` restricts brightnessctl to the display backlight, so
      // on a host without one (external monitors only) it fails soft instead of
      // dimming whatever LED happens to be the first device it finds. The
      // `--min-value=` floor stops a lower from blacking the screen out; the
      // value must be attached to the flag (brightnessctl's min-value is an
      // optional getopt argument, so a separate `-n 5%` token is ignored).
      return arg === null
        ? Promise.resolve()
        : run('brightnessctl', [
            '--class=backlight',
            `--min-value=${BRIGHTNESS_MIN_PERCENT}%`,
            'set',
            arg,
          ]);
    },
  };
}

/**
 * Pick the system-control backend for the running desktop: KDE injects media
 * keys (Plasma OSD); every other compositor uses the system CLIs so volume and
 * brightness work without per-compositor key binds. The CLIs are on PATH, so the
 * same build runs across distros.
 */
export function createSystemControlBackend(
  desktop: string,
  deps: SystemControlDeps,
): SystemControlBackend {
  return desktop === 'kde' ? createInjectSystemControl(deps) : createWlrootsSystemControl();
}
