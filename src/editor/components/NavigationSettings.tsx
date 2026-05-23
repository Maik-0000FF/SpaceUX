// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { Fragment } from 'react';

import {
  AIM_SOURCES,
  DEFAULT_GESTURE_THRESHOLD,
  DEFAULT_TWIST_CYCLE_THRESHOLD,
  MAX_LATERAL_DEADZONE,
  MIN_LATERAL_DEADZONE,
  TWIST_CYCLE_PRIORITIES,
  resolveNavigation,
  type AimSource,
  type MenuNavigation,
  type TwistCyclePriority,
} from '@/shared/menu';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useMenuSettings } from '../state/menu-settings';
import { FALLBACK_BUTTON_COUNT } from '../state/nav-input';

import { DualRange } from './DualRange';
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
const GESTURE_KEYS = ['drillIn', 'activate', 'back', 'cycle'] as const;
type GestureKey = (typeof GESTURE_KEYS)[number];
// Plain-language labels, matching the per-item Entry/Exit wording rather
// than the internal gesture keys (drillIn/back/…).
const GESTURE_LABELS: Record<GestureKey, string> = {
  drillIn: 'Open submenu',
  // Fires the hovered leaf's action — the menu-wide way to activate an item
  // without each leaf binding its own input (#160).
  activate: 'Activate item',
  // Just "Go back": back pops a level and walks to the centre; whether the
  // final step closes is the centre's job (its action) or Escape, not back's
  // — so "/ close" would over-claim (#147 fallback + the Escape hatch).
  back: 'Go back',
  cycle: 'Step through items',
};

// Plain-language labels for the aim source (#159), naming the axes so the
// user can match the dropdown to the way they move the puck. "Both" spells
// out that the two contribute equally.
const AIM_LABELS: Record<AimSource, string> = {
  push: 'Push (TX / TY)',
  tilt: 'Tilt (RX / RY)',
  both: 'Push + Tilt (equal)',
  // Lateral pointing off; the selection only moves by twisting (RZ),
  // through the "Step through items" gesture below.
  twist: 'Twist (RZ — step only)',
};

/** Default threshold to seed a fresh analog input with, per gesture:
 *  cycle sits below the drill range (gentle twist steps, firm twist
 *  drills), the rest use the shared gesture default. */
function defaultThresholdFor(key: GestureKey): number {
  return key === 'cycle' ? DEFAULT_TWIST_CYCLE_THRESHOLD : DEFAULT_GESTURE_THRESHOLD;
}

/** Rendered in its own "Navigation" section in Properties — the global
 *  navigation gestures + aim/deadzone that a navigation style configures.
 *  Pulls the connected device's button count itself (the section is now a
 *  sibling of "Menu settings", not nested under it). */
export function NavigationSettings() {
  const navigation = useMenuSettings((s) => s.config?.navigation);
  const setNavigation = useMenuSettings((s) => s.setNavigation);
  const nav = resolveNavigation({ navigation });
  // Connected device's button count (0 = none/unknown) constrains the
  // button pickers to buttons that exist (#66).
  const { buttons: buttonCount } = useDeviceInfo();
  const offeredButtons = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;

  // Clone (the resolved fallback is frozen) → mutate → store.
  const commit = (mutator: (n: MenuNavigation) => void): void => {
    const next = structuredClone(nav);
    mutator(next);
    setNavigation(next);
  };

  // Twist aiming has no lateral pointer — the selection can only move via a
  // cycle step, which needs an axis. Flag the soft-lock inline so it's
  // visible in Properties, not just a console warning at load (#160).
  const twistNeedsCycle =
    nav.aim === 'twist' && !nav.cycle.inputs.some((input) => input.kind === 'axis');

  return (
    <>
      <Row label="Aim with">
        <select
          className={styles.select}
          value={nav.aim}
          onChange={(e) =>
            commit((n) => {
              n.aim = e.target.value as AimSource;
            })
          }
        >
          {AIM_SOURCES.map((a) => (
            <option key={a} value={a}>
              {AIM_LABELS[a]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Aim deadzone">
        <DualRange
          min={MIN_LATERAL_DEADZONE}
          max={MAX_LATERAL_DEADZONE}
          step={5}
          // Inert for twist aiming (no lateral pointer), so disable it there
          // rather than imply it does something.
          disabled={nav.aim === 'twist'}
          low={nav.hoverDeadzone}
          high={nav.deadzone}
          lowLabel="Hover threshold"
          highLabel="Engage threshold"
          onChange={(hover, engage) =>
            commit((n) => {
              n.deadzone = engage;
              n.hoverDeadzone = hover;
            })
          }
        />
        <span className={styles.navThreshold}>
          {nav.hoverDeadzone} – {nav.deadzone}
        </span>
      </Row>
      {nav.aim !== 'twist' && (
        <p className={styles.sectionNote}>
          Two thresholds: the higher (right handle) is the push needed to leave the centre and
          engage a sector; the lower (left handle) is what holds the aim once an item is selected,
          so moving between items is lighter than entering — the band between them is the
          hysteresis.
        </p>
      )}
      {twistNeedsCycle && (
        <div className={styles.warning}>
          ⚠ Twist aiming moves the selection only by stepping — bind an axis (e.g. Twist&nbsp;RZ)
          under “Step through items” below, or the selection can’t leave the centre.
        </div>
      )}
      {GESTURE_KEYS.map((key) => (
        <Fragment key={key}>
          <div className={styles.subheading}>{GESTURE_LABELS[key]}</div>
          {nav[key].inputs.map((input, i) => (
            <Row key={i} label={`Input ${i + 1}`}>
              <NavInputRow
                input={input}
                offeredButtons={offeredButtons}
                defaultThreshold={defaultThresholdFor(key)}
                // Stepping needs a direction — only an axis can say which
                // way to cycle, so the cycle picker offers axes only (#160).
                axisOnly={key === 'cycle'}
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
