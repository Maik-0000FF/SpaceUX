// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  DEFAULT_TRIGGER_BUTTON,
  DEFAULT_TRIGGER_MODE,
  TRIGGER_MODES,
  type TriggerMode,
} from '@/shared/menu';

import { useDeviceInfo } from '../hooks/useDeviceInfo';
import {
  collectButtonBindings,
  conflictsOn,
  severityOf,
  type ConflictSeverity,
} from '../state/button-conflicts';
import { useMenuSettings } from '../state/menu-settings';
import { FALLBACK_BUTTON_COUNT } from '../state/nav-input';

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
  const config = useMenuSettings((s) => s.config);
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
  const offeredButtons = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;
  const effectiveTrigger = triggerButton ?? DEFAULT_TRIGGER_BUTTON;

  // Button-conflict detection (#75). Only meaningful in toggle mode: in
  // open-only mode the trigger just opens, so it may freely share a button
  // with a gesture. `selfSource` keeps the trigger from flagging itself.
  const bindings = config ? collectButtonBindings(config) : [];
  const triggerConflicts = (b: number) =>
    effectiveMode === 'toggle' ? conflictsOn(bindings, b, 'Trigger button') : [];
  const SEVERITY_CLASS: Record<ConflictSeverity, string | undefined> = {
    free: undefined,
    soft: styles.optSoft,
    hard: styles.optHard,
  };
  const currentConflicts = triggerConflicts(effectiveTrigger);
  // The clamp blocks entering an out-of-range value but can't fix one
  // already saved (e.g. a config from a larger puck) — flag it so the
  // stale binding is visible rather than silently invalid.
  const triggerOutOfRange = maxButton !== undefined && effectiveTrigger > maxButton;

  return (
    <>
      <Row label="Trigger button">
        <select
          className={styles.select}
          value={effectiveTrigger}
          onChange={(e) => setTriggerButton(Number(e.target.value))}
        >
          {Array.from({ length: offeredButtons }, (_, b) => {
            const conflicts = triggerConflicts(b);
            const severity = severityOf(conflicts);
            return (
              <option key={b} value={b} className={SEVERITY_CLASS[severity]}>
                Button {b}
                {conflicts.length > 0 && ` (used by ${conflicts.map((c) => c.source).join(', ')})`}
              </option>
            );
          })}
          {triggerOutOfRange && (
            <option value={effectiveTrigger} disabled>
              Button {effectiveTrigger} (unavailable)
            </option>
          )}
        </select>
        {triggerOutOfRange && (
          <span className={styles.fieldError}>
            This device has {buttonCount} buttons (0–{maxButton}). Pick a lower button.
          </span>
        )}
        {currentConflicts.length > 0 && (
          <span className={styles.fieldWarn}>
            Also used by {currentConflicts.map((c) => c.source).join(', ')}. The same press would do
            both.
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
