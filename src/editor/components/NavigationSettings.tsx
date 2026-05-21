// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { Fragment } from 'react';

import {
  ACTIVATION_DIRECTIONS,
  DEFAULT_ACTIVATION_THRESHOLD,
  DEFAULT_TWIST_CYCLE_THRESHOLD,
  MAGNITUDE_SOURCES,
  MENU_AXES,
  TWIST_CYCLE_PRIORITIES,
  resolveNavigation,
  type ActivationDirection,
  type MagnitudeSource,
  type MenuNavigation,
  type TwistCyclePriority,
} from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';
import { inputFromValue, inputThreshold, inputValue } from '../state/nav-input';

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

/** Default threshold to seed a fresh analog input with, per gesture:
 *  cycle sits below the drill range (gentle twist steps, firm twist
 *  drills), the rest use the activation default. */
function defaultThresholdFor(key: GestureKey): number {
  return key === 'cycle' ? DEFAULT_TWIST_CYCLE_THRESHOLD : DEFAULT_ACTIVATION_THRESHOLD;
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
      <div className={styles.heading}>Navigation</div>
      {GESTURE_KEYS.map((key) => (
        <Fragment key={key}>
          <div className={styles.subheading}>{GESTURE_LABELS[key]}</div>
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
                        n[key].inputs[i] = inputFromValue(
                          e.target.value,
                          inputThreshold(input),
                          defaultThresholdFor(key),
                        );
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
