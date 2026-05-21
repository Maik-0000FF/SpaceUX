// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_TRIGGER_BUTTON, MAX_PIE_SCALE, MIN_PIE_SCALE } from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';

import { CenterFieldSettings } from './CenterFieldSettings';
import { NavigationSettings } from './NavigationSettings';
import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Menu-level settings shown when no sector is selected: the trigger button
 * that opens this pie, the pie size, and the configurable center field.
 * Operate on the whole config rather than a single sector. The size slider
 * updates the store on every input, so the preview (and a live overlay)
 * resize as you drag.
 */
export function MenuSettings() {
  const triggerButton = useMenuSettings((s) => s.config?.triggerButton);
  const setTriggerButton = useMenuSettings((s) => s.setTriggerButton);
  const scale = useMenuSettings((s) => s.config?.scale ?? 1);
  const setScale = useMenuSettings((s) => s.setScale);

  return (
    <>
      <Row label="Trigger button">
        <input
          className={styles.input}
          type="number"
          min={0}
          value={triggerButton ?? DEFAULT_TRIGGER_BUTTON}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 0) setTriggerButton(n);
          }}
        />
      </Row>
      <Row label={`Pie size — ${Math.round(scale * 100)}%`}>
        <input
          type="range"
          style={{ width: '100%' }}
          min={MIN_PIE_SCALE}
          max={MAX_PIE_SCALE}
          step={0.05}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
        />
      </Row>
      <CenterFieldSettings />
      <NavigationSettings />
    </>
  );
}
