// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_TRIGGER_BUTTON } from '@/shared/menu';

import { useMenuSettings } from '../state/menu-settings';

import { Row } from './Row';
import styles from './Properties.module.scss';

/**
 * Menu-level settings shown when no sector is selected: the trigger
 * button index that opens this pie. Operates on the whole config rather
 * than a single sector.
 */
export function MenuSettings() {
  const triggerButton = useMenuSettings((s) => s.config?.triggerButton);
  const setTriggerButton = useMenuSettings((s) => s.setTriggerButton);

  return (
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
  );
}
