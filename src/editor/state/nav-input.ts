// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Encode/decode helpers for the navigation input dropdown (#105/#111).
 * Pure and React/CSS-free so the `inputValue` ⇄ `inputFromValue`
 * round-trip — where a wrong `split(':')` index would silently corrupt
 * a binding — is unit-testable on its own.
 */

import type {
  ActivationDirection,
  InputBinding,
  MagnitudeSource,
  MenuAxisName,
} from '@/shared/menu';

/** Buttons the input dropdown offers when no device is connected (count
 *  0) — covers a SpaceNavigator through the common pucks. With a device
 *  attached the daemon-reported count is used instead (#66). Shared by
 *  the navigation editor and the per-sector activation control. */
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
