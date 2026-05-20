// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';

import { MenuList } from './components/MenuList';
import { MenuPreview } from './components/MenuPreview';
import { Properties } from './components/Properties';
import { useMenuSettings } from './state/menu-settings';

import styles from './App.module.scss';

/**
 * Editor root. On mount it signals readiness and pulls the current
 * menu config into the menu-settings store; the three panels render
 * from the stores and stay in sync through the shared `selectedPath`
 * (app-state). PR Editor-2 is still read-only — selection works, but
 * editing the config is PR Editor-3a.
 */
export function App() {
  const setConfig = useMenuSettings((s) => s.setConfig);

  useEffect(() => {
    window.editor.ready();
    let cancelled = false;
    void window.editor.getMenuConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [setConfig]);

  return (
    <div className={styles.shell}>
      <MenuList />
      <main className={styles.center}>
        <MenuPreview />
      </main>
      <Properties />
    </div>
  );
}
