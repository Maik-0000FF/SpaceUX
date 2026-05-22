// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  ACTIVATION_DIRECTIONS,
  MAGNITUDE_SOURCES,
  MENU_AXES,
  type ActivationDirection,
  type InputBinding,
  type MagnitudeSource,
} from '@/shared/menu';

import { inputFromValue, inputThreshold, inputValue } from '../state/nav-input';

import styles from './Properties.module.scss';

const DIRECTION_SYMBOL: Record<ActivationDirection, string> = {
  positive: '+',
  negative: '−',
  both: '±',
};
const MAGNITUDE_LABEL: Record<MagnitudeSource, string> = {
  lateral: 'Push (TX/TY)',
  tilt: 'Tilt (RX/RY)',
};

/**
 * One input-binding picker row: a dropdown listing every input the
 * device offers (none / buttons / split axes / 2D magnitudes) plus an
 * inline threshold for the analog kinds and a remove button. Shared by
 * the menu-level navigation editor and the per-sector activation control
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
                {axis.toUpperCase()} {DIRECTION_SYMBOL[dir]}
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
