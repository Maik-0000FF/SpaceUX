// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { Fragment } from 'react';

import {
  ACTIVATION_DIRECTIONS,
  DEFAULT_ACTIVATION_THRESHOLD,
  MAGNITUDE_SOURCES,
  MENU_AXES,
  TWIST_CYCLE_PRIORITIES,
  resolveNavigation,
  type ActivationDirection,
  type InputBinding,
  type MagnitudeSource,
  type MenuAxisName,
  type MenuNavigation,
  type TwistCyclePriority,
} from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';

import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Editor for the menu-level navigation bindings (issue #105): each
 * gesture (drill in, back, cycle, commit-center) maps to a list of
 * inputs, any of which fires it. Every input is picked from one
 * dropdown listing all the possibilities — device buttons, split axes,
 * and 2D push/tilt magnitudes — plus a threshold for the analog ones.
 *
 * The bindings drive the runtime directly (see useDrillNavigation), so
 * edits here take effect on the next menu open. Per-sector overrides
 * land in a later PR.
 */

/** Device button count we offer until the daemon advertises the real
 *  one (see #66). 8 covers a SpaceNavigator through the common pucks. */
const FALLBACK_BUTTON_COUNT = 8;

const GESTURE_KEYS = ['drillIn', 'back', 'cycle', 'commitCenter'] as const;
type GestureKey = (typeof GESTURE_KEYS)[number];
const GESTURE_LABELS: Record<GestureKey, string> = {
  drillIn: 'Drill in',
  back: 'Back / dismiss',
  cycle: 'Cycle sectors',
  commitCenter: 'Commit center',
};

const DIRECTION_SYMBOL: Record<ActivationDirection, string> = {
  positive: '+',
  negative: '−',
  both: '±',
};
const MAGNITUDE_LABEL: Record<MagnitudeSource, string> = {
  lateral: 'Push (TX/TY)',
  tilt: 'Tilt (RX/RY)',
};

/** Encode an input binding as the dropdown's option value. */
function inputValue(input: InputBinding): string {
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

/** Decode a dropdown option value back to an input binding, carrying a
 *  previous analog threshold across a kind change where it still
 *  applies (so flipping an axis direction keeps the tuned value). */
function inputFromValue(value: string, prevThreshold: number | null): InputBinding {
  const threshold = prevThreshold ?? DEFAULT_ACTIVATION_THRESHOLD;
  if (value === 'none') return { kind: 'none' };
  const [kind, a, b] = value.split(':');
  if (kind === 'button') return { kind: 'button', button: Number(a) };
  if (kind === 'magnitude') return { kind: 'magnitude', source: a as MagnitudeSource, threshold };
  return { kind: 'axis', axis: a as MenuAxisName, direction: b as ActivationDirection, threshold };
}

/** Threshold of an analog input, or null for button/none. */
function inputThreshold(input: InputBinding): number | null {
  return input.kind === 'axis' || input.kind === 'magnitude' ? input.threshold : null;
}

export function NavigationSettings() {
  const navigation = useMenuSettings((s) => s.config?.navigation);
  const setNavigation = useMenuSettings((s) => s.setNavigation);
  const nav = resolveNavigation({ navigation });

  // Clone (the resolved fallback is frozen) → mutate → store.
  const commit = (mutator: (n: MenuNavigation) => void): void => {
    const next = structuredClone(nav);
    mutator(next);
    setNavigation(next);
  };

  return (
    <>
      {GESTURE_KEYS.map((key) => (
        <Fragment key={key}>
          <div className={styles.heading}>{GESTURE_LABELS[key]}</div>
          {nav[key].inputs.map((input, i) => {
            const threshold = inputThreshold(input);
            return (
              <Row key={i} label={`Input ${i + 1}`}>
                <div className={styles.navInputRow}>
                  <select
                    className={styles.select}
                    value={inputValue(input)}
                    onChange={(e) =>
                      commit((n) => {
                        n[key].inputs[i] = inputFromValue(e.target.value, inputThreshold(input));
                      })
                    }
                  >
                    <option value="none">None</option>
                    <optgroup label="Buttons">
                      {Array.from({ length: FALLBACK_BUTTON_COUNT }, (_, b) => (
                        <option key={b} value={`button:${b}`}>
                          Button {b}
                        </option>
                      ))}
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
                        if (Number.isFinite(v) && v > 0)
                          commit((n) => {
                            const inp = n[key].inputs[i]!;
                            if (inp.kind === 'axis' || inp.kind === 'magnitude') inp.threshold = v;
                          });
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className={styles.navRemove}
                    title="Remove this input"
                    onClick={() =>
                      commit((n) => {
                        n[key].inputs.splice(i, 1);
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              </Row>
            );
          })}
          <button
            type="button"
            className={styles.openButton}
            onClick={() =>
              commit((n) => {
                n[key].inputs.push({ kind: 'none' });
              })
            }
          >
            + Add input
          </button>
          {key === 'cycle' && (
            <Row label="When also aiming">
              <select
                className={styles.select}
                value={nav.cycle.priority}
                onChange={(e) =>
                  commit((n) => {
                    n.cycle.priority = e.target.value as TwistCyclePriority;
                  })
                }
              >
                {TWIST_CYCLE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p === 'lateral' ? 'Lateral aiming wins' : 'Twist wins'}
                  </option>
                ))}
              </select>
            </Row>
          )}
        </Fragment>
      ))}
    </>
  );
}
