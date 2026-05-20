// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { sectorKey } from '../state/sector-keys';
import { ringSectors } from '../state/selectors';

import styles from './MenuList.module.scss';

/**
 * Left sidebar: the sectors of the ring currently in view (top level, or
 * a submenu after drilling in). Clicking selects; the "›" button on a
 * submenu drills into it. "+ Add item" appends to the current ring;
 * items reorder by drag-and-drop. Delete and the breadcrumb live
 * elsewhere (Properties / PreviewHeader).
 */
export function MenuList() {
  const config = useMenuSettings((s) => s.config);
  const addSector = useMenuSettings((s) => s.addSector);
  const moveSector = useMenuSettings((s) => s.moveSector);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectSector = useAppState((s) => s.selectSector);
  const drillInto = useAppState((s) => s.drillInto);

  const sectors = config ? ringSectors(config, viewPath) : [];
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleAdd = (): void => {
    addSector(viewPath);
    const current = useMenuSettings.getState().config;
    if (current) selectSector(ringSectors(current, viewPath).length - 1);
  };

  const handleDrop = (target: number): void => {
    if (dragIndex !== null && dragIndex !== target) {
      moveSector(viewPath, dragIndex, target);
      selectSector(target); // keep the moved item selected
    }
    setDragIndex(null);
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Menu</div>
      {sectors.length === 0 ? (
        <p className={styles.empty}>{config ? 'No sectors configured.' : 'Loading…'}</p>
      ) : (
        <ul className={styles.list}>
          {sectors.map((sector, i) => (
            // Identity key (see sector-keys): survives reorder so React
            // reconciles by sector, not array position.
            <li
              key={sectorKey(sector)}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => setDragIndex(null)}
              className={`${styles.row} ${dragIndex === i ? styles.dragging : ''}`}
            >
              <button
                type="button"
                className={`${styles.item} ${selectedIndex === i ? styles.itemSelected : ''}`}
                aria-current={selectedIndex === i ? 'true' : undefined}
                onClick={() => selectSector(i)}
              >
                {sector.label}
              </button>
              {/* Only offer drill when the submenu has a ring to show:
                  currentSectors treats empty children as stale and would
                  land on the root ring (unreachable today — the validator
                  rejects empty children — but keeps the affordance honest). */}
              {sector.children !== undefined && sector.children.length > 0 && (
                <button
                  type="button"
                  className={styles.drill}
                  title="Open submenu"
                  aria-label={`Open submenu ${sector.label}`}
                  onClick={() => drillInto(i)}
                >
                  ›
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {config !== null && (
        <button type="button" className={styles.addButton} onClick={handleAdd}>
          + Add item
        </button>
      )}
    </aside>
  );
}
