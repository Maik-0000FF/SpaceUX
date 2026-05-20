// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { MenuConfig } from '@/shared/menu';

import styles from './App.module.scss';

/**
 * Editor root. PR Editor-1 is a read-only skeleton: on mount it
 * signals readiness, pulls the current menu config, and lists the
 * top-level sector labels in the left sidebar. Selection state, the
 * live pie preview, and the properties panel are wired in PR
 * Editor-2; write-back in PR Editor-3a. The centre and right columns
 * are intentional placeholders for now.
 */
export function App() {
  const [config, setConfig] = useState<MenuConfig | null>(null);

  useEffect(() => {
    window.editor.ready();
    let cancelled = false;
    void window.editor.getMenuConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sectors = config?.sectors ?? [];

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.panelHeading}>Menu</div>
        {sectors.length === 0 ? (
          <p className={styles.empty}>{config ? 'No sectors configured.' : 'Loading…'}</p>
        ) : (
          <ul className={styles.menuList}>
            {sectors.map((sector, i) => (
              // Index key: MenuSector has no stable id and labels aren't
              // guaranteed unique, so the index is the only correct key
              // today. It also matches the index-path selection model the
              // later PRs use. When reorder/add/delete land (PR Editor-4)
              // a stable per-sector id should be introduced and used here.
              <li key={i} className={styles.menuItem}>
                {sector.label}
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className={styles.center} />

      <aside className={styles.sidebarRight}>
        <div className={styles.panelHeading}>Properties</div>
      </aside>
    </div>
  );
}
