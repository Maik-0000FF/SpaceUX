// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PieThemeChoice } from '@/shared/ipc';

import { usePieAppearance } from '../hooks/usePieAppearance';
import { PICKER_TOOLTIPS, THEME_OPTION_TOOLTIPS } from '../tooltips';

import { Tooltip } from './Tooltip';
import styles from './PieThemeSelect.module.scss';

/**
 * Pie theme quick-pick for the left design bar, beside the navigation-style
 * dropdown. A selector (discrete choice), grouped with the other selectors;
 * the continuous pie values live in the slider panel over the preview.
 */
export function PieThemeSelect() {
  const { appearance: pie, setTheme } = usePieAppearance();

  return (
    <label className={styles.control}>
      <Tooltip content={PICKER_TOOLTIPS.theme}>
        <span className={styles.label}>Theme</span>
      </Tooltip>
      <select
        className={styles.select}
        value={pie.theme}
        onChange={(e) => setTheme(e.target.value as PieThemeChoice)}
      >
        <option value="dark" title={THEME_OPTION_TOOLTIPS.dark}>
          Dark
        </option>
        <option value="light" title={THEME_OPTION_TOOLTIPS.light}>
          Light
        </option>
        <option value="spaceux" title={THEME_OPTION_TOOLTIPS.spaceux}>
          SpaceUX
        </option>
      </select>
    </label>
  );
}
