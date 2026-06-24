// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Button-conflict detection for the desktop-mode config (#199). A device button
 * can be claimed by the toggle button and by a button-bound desktop function
 * (overview / show-desktop): two on the same button fight, and a button that
 * equals the active menu's pie-open trigger would steal the pie. Axes can't
 * collide (each axis is its own input), so only the button assignments matter.
 * Pure and store-free so the collision logic is unit-testable on its own.
 */

import type { DesktopSettings } from '../shared/ipc.js';

/** A desktop button binding that shares its button with something else. */
export type DesktopButtonConflict = {
  /** True if the button is the active menu's pie-open trigger. */
  withTrigger: boolean;
  /** Display labels of the other desktop bindings sharing this button. */
  others: string[];
  /** Hard conflict (red): the button is the pie trigger AND desktop mode is
   *  always on, so the trigger always fires the desktop function and the pie can
   *  never open. In toggle mode the same overlap is a usable dual-function
   *  (trigger while off, function while on), not a hard conflict. */
  hard: boolean;
};

/** What a conflict is keyed by: the toggle picker, or a bound button index. */
export type DesktopConflictKey = 'toggle' | number;

const FUNCTION_LABELS: Record<'overview' | 'showDesktop', string> = {
  overview: 'Overview',
  showDesktop: 'Show desktop',
};

function labelFor(key: DesktopConflictKey, settings: DesktopSettings): string {
  if (key === 'toggle') return 'Toggle desktop mode';
  const fn = settings.buttons[key];
  if (fn === undefined || fn === 'none') return `Button ${key}`;
  if (typeof fn === 'object') return 'Action';
  return FUNCTION_LABELS[fn];
}

/**
 * Find which desktop button bindings collide. The toggle button (when in toggle
 * mode) and every non-none button function are checked against each other and
 * the pie trigger. Returns a map keyed by binding (the toggle picker, or a
 * button index), populated only for bindings that actually collide, so the UI
 * can flag exactly the offending pickers.
 */
export function desktopButtonConflicts(
  settings: DesktopSettings,
  triggerButton: number | null,
): Map<DesktopConflictKey, DesktopButtonConflict> {
  const used: { key: DesktopConflictKey; button: number }[] = [];
  if (settings.activationMode === 'toggle' && settings.toggleButton !== null) {
    used.push({ key: 'toggle', button: settings.toggleButton });
  }
  for (const [idxStr, fn] of Object.entries(settings.buttons)) {
    if (fn === 'none') continue;
    const idx = Number(idxStr);
    used.push({ key: idx, button: idx });
  }

  const conflicts = new Map<DesktopConflictKey, DesktopButtonConflict>();
  for (const { key, button } of used) {
    const others = used
      .filter((u) => u.key !== key && u.button === button)
      .map((u) => labelFor(u.key, settings));
    const withTrigger = triggerButton !== null && button === triggerButton;
    // Hard (the pie becomes unreachable): the toggle button on the trigger (the
    // pie always wins, so the toggle never engages), or a function button on the
    // trigger while desktop mode is always on (the trigger always fires the
    // function). In toggle mode a function on the trigger is a usable
    // dual-function (trigger while off, function while on), so only soft.
    const hard = withTrigger && (key === 'toggle' || settings.activationMode === 'always');
    if (others.length > 0 || withTrigger) {
      conflicts.set(key, { withTrigger, others, hard });
    }
  }
  return conflicts;
}

/** A human-readable tooltip for a conflict, naming what else claims the button. */
export function desktopConflictMessage(conflict: DesktopButtonConflict): string {
  if (conflict.hard) {
    return 'This is the pie trigger; this combination makes the pie unreachable. Rebind one of them.';
  }
  if (conflict.withTrigger) {
    const extra = conflict.others.length
      ? ` It also shares with ${conflict.others.join(', ')}.`
      : '';
    return `This is also the pie trigger: in toggle mode the button opens the pie while desktop mode is off and runs this function while it is on.${extra}`;
  }
  return `Shares this button with ${conflict.others.join(', ')}; they may fight.`;
}
