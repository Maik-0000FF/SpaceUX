// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  DEFAULT_TWIST_CYCLE_THRESHOLD,
  TWIST_CYCLE_PRIORITIES,
  type MenuTwistCycle,
  type TwistCyclePriority,
} from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';

import { Row } from './Row';
import styles from './Properties.module.scss';

/** Labels for the priority dropdown — what wins when the puck is both
 *  twisted and pushed laterally in the same frame. */
const PRIORITY_LABELS: Record<TwistCyclePriority, string> = {
  lateral: 'Lateral aiming wins',
  twist: 'Twist wins',
};

/**
 * Menu-level editor for the twist-to-cycle gesture: twisting the puck
 * (RZ) steps the highlighted sector one at a time instead of aiming at
 * it. Exposes the enable toggle, the step threshold, and the
 * priority — whether a twist or lateral aiming wins when both happen at
 * once — which is the part the gesture most needs surfaced in the GUI.
 *
 * Shares RZ with twist-drill via a threshold split; the threshold hint
 * nudges the user to keep this below their drill threshold so a gentle
 * twist steps and a firmer one drills.
 */
export function TwistCycleSettings() {
  const twistCycle = useMenuSettings((s) => s.config?.twistCycle);
  const setTwistCycle = useMenuSettings((s) => s.setTwistCycle);

  const enabled = twistCycle?.enabled === true;

  const update = (patch: Partial<MenuTwistCycle>): void => {
    const base: MenuTwistCycle = twistCycle ?? {
      enabled: false,
      threshold: DEFAULT_TWIST_CYCLE_THRESHOLD,
      priority: 'lateral',
    };
    setTwistCycle({ ...base, ...patch });
  };

  return (
    <>
      <div className={styles.heading}>Twist cycle</div>
      <Row label="Twist to step sectors">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
      </Row>
      {enabled && (
        <>
          <Row label="Step threshold">
            <input
              className={styles.input}
              type="number"
              min={1}
              value={twistCycle?.threshold ?? DEFAULT_TWIST_CYCLE_THRESHOLD}
              title="Keep below the twist-drill threshold so a gentle twist steps and a firmer one drills"
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0) update({ threshold: n });
              }}
            />
          </Row>
          <Row label="When also aiming">
            <select
              className={styles.select}
              value={twistCycle?.priority ?? 'lateral'}
              onChange={(e) => update({ priority: e.target.value as TwistCyclePriority })}
            >
              {TWIST_CYCLE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Row>
        </>
      )}
    </>
  );
}
