// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  ACTIVATION_DIRECTIONS,
  MAGNITUDE_SOURCES,
  MENU_AXES,
  type ActivationDirection,
  type InputBinding,
  type MagnitudeSource,
  type MenuAxisName,
} from '@/shared/menu';

import { inputFromValue, inputThreshold, inputValue } from '../state/nav-input';

import styles from './Properties.module.scss';

const DIRECTION_SYMBOL: Record<ActivationDirection, string> = {
  positive: '+',
  negative: '−',
  both: '±',
};
const MAGNITUDE_LABEL: Record<MagnitudeSource, string> = {
  // "Slide" matches the TX/TY axis verbs — this is the direction-agnostic
  // lateral magnitude (hypot of TX/TY), i.e. slide the puck any way.
  lateral: 'Slide (TX/TY)',
  tilt: 'Tilt (RX/RY)',
};

// Plain-language motion per axis so the dropdown reads as physical
// gestures, not raw axis codes. `base` is the direction-agnostic verb
// (used for the `both` split); positive/negative add a direction. The
// lateral/tilt sign→direction mapping is a best-effort default — every
// SpaceMouse model wires TX/TY/RX/RY signs differently and KDE's sense
// varies (see the MenuAxisInvert note in shared/menu.ts), so the raw axis
// + sign always stays in parentheses as the ground truth. TZ follows the
// coordinate convention TZ− = down/press, TZ+ = up/lift; a daemon-level
// sign inversion that breaks that on real hardware is tracked in #153.
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

/** "Tilt left (RY−)" — motion phrase + the raw axis/sign in parens. */
function axisOptionLabel(axis: MenuAxisName, dir: ActivationDirection): string {
  const m = AXIS_MOTION[axis];
  const phrase = dir === 'positive' ? m.positive : dir === 'negative' ? m.negative : m.base;
  return `${phrase} (${axis.toUpperCase()}${DIRECTION_SYMBOL[dir]})`;
}

/**
 * One input-binding picker row: a dropdown listing every input the
 * device offers (none / buttons / split axes / 2D magnitudes) plus an
 * inline threshold for the analog kinds and a remove button. Shared by
 * the menu-level navigation editor and the per-node activation control
 * so the two can't drift on the option set or the encode/decode round
 * trip. The caller owns the binding list (add/remove, where it's stored);
 * this row just edits one entry.
 */
export function NavInputRow({
  input,
  offeredButtons,
  defaultThreshold,
  onChange,
  onRemove,
}: {
  input: InputBinding;
  /** How many device buttons to offer (connected count, or a fallback). */
  offeredButtons: number;
  /** Threshold to seed a fresh analog input with when none carries over. */
  defaultThreshold: number;
  onChange: (next: InputBinding) => void;
  onRemove: () => void;
}) {
  const threshold = inputThreshold(input);
  // A saved binding may reference a button the connected device doesn't
  // have (e.g. a config carried over from a larger puck). Surface it as a
  // flagged, disabled option so the select shows it as selected instead
  // of silently falling back to the first entry.
  const staleButton =
    input.kind === 'button' && input.button >= offeredButtons ? input.button : null;

  return (
    <div className={styles.navInputRow}>
      <select
        className={styles.select}
        value={inputValue(input)}
        onChange={(e) => onChange(inputFromValue(e.target.value, threshold, defaultThreshold))}
      >
        <option value="none">None</option>
        <optgroup label="Buttons">
          {Array.from({ length: offeredButtons }, (_, b) => (
            <option key={b} value={`button:${b}`}>
              Button {b}
            </option>
          ))}
          {staleButton !== null && (
            <option value={`button:${staleButton}`} disabled>
              Button {staleButton} (unavailable)
            </option>
          )}
        </optgroup>
        <optgroup label="Axes">
          {MENU_AXES.flatMap((axis) =>
            ACTIVATION_DIRECTIONS.map((dir) => (
              <option key={`${axis}:${dir}`} value={`axis:${axis}:${dir}`}>
                {axisOptionLabel(axis, dir)}
              </option>
            )),
          )}
        </optgroup>
        <optgroup label="Magnitude">
          {MAGNITUDE_SOURCES.map((source) => (
            <option key={source} value={`magnitude:${source}`}>
              {MAGNITUDE_LABEL[source]}
            </option>
          ))}
        </optgroup>
      </select>
      {threshold !== null && (
        <input
          className={styles.navThreshold}
          type="number"
          min={1}
          value={threshold}
          title="Threshold"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (
              Number.isFinite(v) &&
              v > 0 &&
              (input.kind === 'axis' || input.kind === 'magnitude')
            )
              onChange({ ...input, threshold: v });
          }}
        />
      )}
      <button
        type="button"
        className={styles.navRemove}
        title="Remove this input"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}
