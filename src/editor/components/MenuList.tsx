// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { isSelected } from '../state/selectors';

import styles from './MenuList.module.scss';

/**
 * Left sidebar: the top-level pie sectors as a clickable list. Clicking
 * an entry selects that sector (single-element path); the preview and
 * properties panel react to the same `selectedPath`. Read-only in
 * PR Editor-2 — no add/delete/reorder yet (PR Editor-4).
 */
export function MenuList() {
  const config = useMenuSettings((s) => s.config);
  const selectedPath = useAppState((s) => s.selectedPath);
  const selectSector = useAppState((s) => s.selectSector);
  const sectors = config?.sectors ?? [];

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Menu</div>
      {sectors.length === 0 ? (
        <p className={styles.empty}>{config ? 'No sectors configured.' : 'Loading…'}</p>
      ) : (
        <ul className={styles.list}>
          {sectors.map((sector, i) => {
            // Index key: see app-state for why the index is the only
            // correct key today (no stable sector id yet).
            const selected = isSelected(selectedPath, i);
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`${styles.item} ${selected ? styles.itemSelected : ''}`}
                  onClick={() => selectSector([i])}
                >
                  {sector.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
