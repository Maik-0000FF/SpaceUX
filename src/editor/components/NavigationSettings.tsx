// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { Fragment } from 'react';

import {
  DEFAULT_GESTURE_THRESHOLD,
  DEFAULT_TWIST_CYCLE_THRESHOLD,
  TWIST_CYCLE_PRIORITIES,
  resolveNavigation,
  type MenuNavigation,
  type TwistCyclePriority,
} from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';
import { FALLBACK_BUTTON_COUNT } from '../state/nav-input';

import { NavInputRow } from './NavInputRow';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Editor for the menu-level ring-navigation bindings (issue #105): each
 * gesture (drill in, back, cycle) maps to a list of inputs, any of which
 * fires it. The centre's own trigger (commitCenter) lives in the centre
 * editor — see RootSettings. Every input is picked from one
 * dropdown listing all the possibilities — device buttons, split axes,
 * and 2D push/tilt magnitudes — plus a threshold for the analog ones.
 *
 * The bindings drive the runtime directly (see useDrillNavigation), so
 * edits here take effect on the next menu open. Per-node overrides
 * land in a later PR.
 */

// commitCenter is the *centre's* trigger — it lives with the centre's
// label + action in RootSettings now (#129 consolidation), not here, so
// this section is purely the ring-navigation gestures.
const GESTURE_KEYS = ['drillIn', 'back', 'cycle'] as const;
type GestureKey = (typeof GESTURE_KEYS)[number];
// Plain-language labels, matching the per-item Entry/Exit wording rather
// than the internal gesture keys (drillIn/back/…).
const GESTURE_LABELS: Record<GestureKey, string> = {
  drillIn: 'Open submenu',
  back: 'Go back / close',
  cycle: 'Step through items',
};

/** Default threshold to seed a fresh analog input with, per gesture:
 *  cycle sits below the drill range (gentle twist steps, firm twist
 *  drills), the rest use the shared gesture default. */
function defaultThresholdFor(key: GestureKey): number {
  return key === 'cycle' ? DEFAULT_TWIST_CYCLE_THRESHOLD : DEFAULT_GESTURE_THRESHOLD;
}

/** @param buttonCount Connected device's button count, or 0 when none —
 *  drives how many buttons the input dropdown offers. */
export function NavigationSettings({ buttonCount }: { buttonCount: number }) {
  const navigation = useMenuSettings((s) => s.config?.navigation);
  const setNavigation = useMenuSettings((s) => s.setNavigation);
  const nav = resolveNavigation({ navigation });
  const offeredButtons = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;

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
          {nav[key].inputs.map((input, i) => (
            <Row key={i} label={`Input ${i + 1}`}>
              <NavInputRow
                input={input}
                offeredButtons={offeredButtons}
                defaultThreshold={defaultThresholdFor(key)}
                onChange={(next) =>
                  commit((n) => {
                    n[key].inputs[i] = next;
                  })
                }
                onRemove={() =>
                  commit((n) => {
                    n[key].inputs.splice(i, 1);
                  })
                }
              />
            </Row>
          ))}
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
