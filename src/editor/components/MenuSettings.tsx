// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  DEFAULT_TRIGGER_BUTTON,
  DEFAULT_TRIGGER_MODE,
  TRIGGER_MODES,
  type TriggerMode,
} from '@/shared/menu';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { useMenuSettings } from '../state/menu-settings';

import { Row } from './Row';
import styles from './Properties.module.scss';

const TRIGGER_MODE_LABELS: Record<TriggerMode, string> = {
  toggle: 'Toggle (open, then commit / close)',
  open: 'Open only',
};

/**
 * Menu-level settings: the trigger button that opens this pie and what it
 * does once open. Operate on the whole config rather than a single node, so
 * Properties shows them in an always-present collapsible section above the
 * selection editor (reachable whatever is selected). The navigation gestures
 * + aim/deadzone live in their own sibling "Navigation" section (see
 * NavigationSettings); the centre/root is edited via its tree row (see
 * RootSettings); pie design — size, theme, opacity — lives in the preview
 * design bar (#107).
 */
export function MenuSettings() {
  const triggerButton = useMenuSettings((s) => s.config?.triggerButton);
  const setTriggerButton = useMenuSettings((s) => s.setTriggerButton);
  const triggerMode = useMenuSettings((s) => s.config?.triggerMode);
  const setTriggerMode = useMenuSettings((s) => s.setTriggerMode);
  const effectiveMode = triggerMode ?? DEFAULT_TRIGGER_MODE;
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
      <Row label="Trigger behavior">
        <select
          className={styles.select}
          value={effectiveMode}
          onChange={(e) => setTriggerMode(e.target.value as TriggerMode)}
        >
          {TRIGGER_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {TRIGGER_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
        <span className={styles.sectionNote}>
          {effectiveMode === 'toggle'
            ? 'Press to open; press again to commit the highlighted item (centred = your cancel / close).'
            : 'The button only opens the menu — commit items and close with your SpaceMouse gestures (the trigger button is then free to bind as an input).'}
        </span>
      </Row>
    </>
  );
}
