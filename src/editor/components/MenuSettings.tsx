// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_TRIGGER_BUTTON } from '@/shared/menu';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useMenuSettings } from '../state/menu-settings';

import { CenterFieldSettings } from './CenterFieldSettings';
import { NavigationSettings } from './NavigationSettings';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Menu-level settings shown when no sector is selected: the trigger button
 * that opens this pie and the configurable center field. Operate on the
 * whole config rather than a single sector. (Pie design — size, theme,
 * opacity — lives in the preview section's design bar, see #107.)
 */
export function MenuSettings() {
  const triggerButton = useMenuSettings((s) => s.config?.triggerButton);
  const setTriggerButton = useMenuSettings((s) => s.setTriggerButton);
  // Connected device's button count (0 = none/unknown). Constrains the
  // button pickers to buttons that exist (#66).
  const { buttons: buttonCount } = useDeviceInfo();
  // Highest selectable button: device count − 1 when known, else open.
  const maxButton = buttonCount > 0 ? buttonCount - 1 : undefined;
  const effectiveTrigger = triggerButton ?? DEFAULT_TRIGGER_BUTTON;
  // The clamp blocks entering an out-of-range value but can't fix one
  // already saved (e.g. a config from a larger puck) — flag it so the
  // stale binding is visible rather than silently invalid.
  const triggerOutOfRange = maxButton !== undefined && effectiveTrigger > maxButton;

  return (
    <>
      <Row label="Trigger button">
        <input
          className={styles.input}
          type="number"
          min={0}
          max={maxButton}
          value={effectiveTrigger}
          onChange={(e) => {
            const n = Number(e.target.value);
            // Reject buttons the connected device doesn't have.
            if (Number.isInteger(n) && n >= 0 && (maxButton === undefined || n <= maxButton))
              setTriggerButton(n);
          }}
        />
        {triggerOutOfRange && (
          <span className={styles.fieldError}>
            This device has {buttonCount} buttons (0–{maxButton}). Pick a lower button.
          </span>
        )}
      </Row>
      <CenterFieldSettings />
      <NavigationSettings buttonCount={buttonCount} />
    </>
  );
}
