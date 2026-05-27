// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ThemeChoice } from '@/shared/ipc';

import { PieFontSettings } from './PieFontSettings';
import { PluginManager } from './PluginManager';

import styles from './SettingsPage.module.scss';

/**
 * The Settings tab: app-level preferences that aren't part of a single menu.
 * Houses the editor interface theme and the plugin manager; pie appearance,
 * navigation, etc. can move here later. The theme state itself lives in App
 * (it applies to <html> regardless of the active tab) and is passed in.
 */
export function SettingsPage({
  theme,
  changeTheme,
}: {
  theme: ThemeChoice;
  changeTheme: (next: ThemeChoice) => void;
}) {
  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h2 className={styles.heading}>Interface theme</h2>
        <p className={styles.desc}>The look of this editor window.</p>
        <select
          className={styles.select}
          value={theme}
          onChange={(e) => changeTheme(e.target.value as ThemeChoice)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="spaceux">SpaceUX</option>
        </select>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Pie fonts</h2>
        <p className={styles.desc}>
          The font for the pie labels, in the live overlay and the preview. The editor window keeps
          its own font. Bundled ships with the app for an identical look on every system.
        </p>
        <PieFontSettings />
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Plugins</h2>
        <p className={styles.desc}>
          Import downloaded plugins and manage installed ones. Function plugins add actions and
          menus; theme plugins style the pie.
        </p>
        <PluginManager />
      </section>
    </div>
  );
}
