// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Encode/decode helpers for the navigation input dropdown (#105/#111).
 * Pure, so the `inputValue` ⇄ `inputFromValue`
 * round-trip — where a wrong `split(':')` index would silently corrupt
 * a binding — is unit-testable on its own.
 */

import type {
  ActivationDirection,
  InputBinding,
  MagnitudeSource,
  MenuAxisName,
} from '../shared/menu.js';

/** Buttons the input dropdown offers when no device is connected (count
 *  0) — covers a SpaceNavigator through the common pucks. With a device
 *  attached the daemon-reported count is used instead (#66). Shared by
 *  the navigation editor and the per-node activation control. */
export const FALLBACK_BUTTON_COUNT = 8;

/** Encode an input binding as the dropdown's option `value`. */
export function inputValue(input: InputBinding): string {
  switch (input.kind) {
    case 'none':
      return 'none';
    case 'button':
      return `button:${input.button}`;
    case 'axis':
      return `axis:${input.axis}:${input.direction}`;
    case 'magnitude':
      return `magnitude:${input.source}`;
  }
}

/**
 * Decode a dropdown option `value` back to an input binding. Carries a
 * previous analog threshold across a kind change where it still applies
 * (so flipping an axis direction keeps the tuned value); otherwise
 * seeds the caller-supplied `defaultThreshold` — which differs per
 * gesture (cycle wants a lower default than the drills).
 */
export function inputFromValue(
  value: string,
  prevThreshold: number | null,
  defaultThreshold: number,
): InputBinding {
  const threshold = prevThreshold ?? defaultThreshold;
  if (value === 'none') return { kind: 'none' };
  const [kind, a, b] = value.split(':');
  if (kind === 'button') return { kind: 'button', button: Number(a) };
  if (kind === 'magnitude') return { kind: 'magnitude', source: a as MagnitudeSource, threshold };
  return { kind: 'axis', axis: a as MenuAxisName, direction: b as ActivationDirection, threshold };
}

/** Threshold of an analog input, or null for button/none. */
export function inputThreshold(input: InputBinding): number | null {
  return input.kind === 'axis' || input.kind === 'magnitude' ? input.threshold : null;
}

// Readable input labels, shared by the dropdown (NavInputRow) and the conflict
// notes (gesture-collision) so the two name a trigger the same way.

const DIRECTION_SYMBOL: Record<ActivationDirection, string> = {
  positive: '+',
  negative: '−',
  both: '±',
};

export const MAGNITUDE_LABEL: Record<MagnitudeSource, string> = {
  // "Slide" matches the TX/TY axis verbs: the direction-agnostic lateral
  // magnitude (hypot of TX/TY), i.e. slide the puck any way.
  lateral: 'Slide (TX/TY)',
  tilt: 'Tilt (RX/RY)',
};

// Plain-language motion per axis so the dropdown reads as physical gestures,
// not raw axis codes. `base` is the direction-agnostic verb (used for the
// `both` split); positive/negative add a direction. The lateral/tilt
// sign->direction mapping is a best-effort default: every SpaceMouse model
// wires TX/TY/RX/RY signs differently and KDE's sense varies (see the
// MenuAxisInvert note in shared/menu.ts), so the raw axis + sign always stays
// in parentheses as the ground truth. TZ follows the coordinate convention
// TZ- = down/press, TZ+ = up/lift; a daemon-level sign inversion that breaks
// that on real hardware is tracked in #153.
const AXIS_MOTION: Record<MenuAxisName, { base: string; positive: string; negative: string }> = {
  tx: { base: 'Slide', positive: 'Slide right', negative: 'Slide left' },
  ty: { base: 'Slide', positive: 'Slide forward', negative: 'Slide back' },
  // `base` (the ± split) stays direction-neutral: TZ both is the shipped
  // default back gesture, so "Press / lift (TZ±)" must read as either way,
  // not just one half.
  tz: { base: 'Press / lift', positive: 'Lift up', negative: 'Press down' },
  rx: { base: 'Tilt', positive: 'Tilt forward', negative: 'Tilt back' },
  ry: { base: 'Tilt', positive: 'Tilt right', negative: 'Tilt left' },
  rz: { base: 'Twist', positive: 'Twist right', negative: 'Twist left' },
};

/** "Tilt left (RY−)": motion phrase + the raw axis/sign in parens. */
export function axisOptionLabel(axis: MenuAxisName, dir: ActivationDirection): string {
  const m = AXIS_MOTION[axis];
  const phrase = dir === 'positive' ? m.positive : dir === 'negative' ? m.negative : m.base;
  return `${phrase} (${axis.toUpperCase()}${DIRECTION_SYMBOL[dir]})`;
}

/** Readable label of an input binding (the dropdown's selected-value text),
 *  reused by the conflict notes so they name the exact shared trigger. */
export function inputLabel(input: InputBinding): string {
  switch (input.kind) {
    case 'none':
      return 'None';
    case 'button':
      return `Button ${input.button}`;
    case 'axis':
      return axisOptionLabel(input.axis, input.direction);
    case 'magnitude':
      return MAGNITUDE_LABEL[input.source];
  }
}
