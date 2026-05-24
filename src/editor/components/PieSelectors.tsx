// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { LiveToggle } from './LiveToggle';
import { NavigationStyle } from './NavigationStyle';
import { PieThemeSelect } from './PieThemeSelect';

import styles from './PieSelectors.module.scss';

/**
 * Left selector column, docked top-left of the preview: the live-preview
 * switch on top, then the discrete pickers (theme · navigation style),
 * stacked. The companion to the right-hand slider panel (PieSliders) —
 * together they flank the preview as two columns. Selectors pick a choice;
 * the sliders tune continuous values.
 */
export function PieSelectors() {
  return (
    <div className={styles.panel}>
      <LiveToggle />
      <PieThemeSelect />
      <NavigationStyle />
    </div>
  );
}
