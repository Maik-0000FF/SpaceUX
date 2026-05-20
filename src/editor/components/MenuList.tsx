// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { isSelected } from '../state/selectors';

import styles from './MenuList.module.scss';

/**
 * Left sidebar: the top-level pie sectors as a clickable, reorderable
 * list. Clicking selects a sector; the preview and properties panel
 * react to the same `selectedPath`. "Add item" appends a sector; items
 * are reordered by drag-and-drop (mouse). Delete lives in the properties
 * panel. All operate on the top level (nested editing is PR Editor-5).
 */
export function MenuList() {
  const config = useMenuSettings((s) => s.config);
  const addSector = useMenuSettings((s) => s.addSector);
  const moveSector = useMenuSettings((s) => s.moveSector);
  const selectedPath = useAppState((s) => s.selectedPath);
  const selectSector = useAppState((s) => s.selectSector);
  const sectors = config?.sectors ?? [];

  // Index of the item being dragged, for the drop handler and a drag
  // style. Null when no drag is in progress.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleAdd = (): void => {
    addSector();
    const current = useMenuSettings.getState().config;
    if (current) selectSector([current.sectors.length - 1]);
  };

  const handleDrop = (target: number): void => {
    if (dragIndex !== null && dragIndex !== target) {
      moveSector(dragIndex, target);
      // Keep the moved item selected at its new position.
      selectSector([target]);
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
          {sectors.map((sector, i) => {
            // Index key: see app-state for why the index is the only
            // correct key today (no stable sector id yet).
            const selected = isSelected(selectedPath, i);
            return (
              <li
                key={i}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => setDragIndex(null)}
                className={dragIndex === i ? styles.dragging : undefined}
              >
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
      {config !== null && (
        <button type="button" className={styles.addButton} onClick={handleAdd}>
          + Add item
        </button>
      )}
    </aside>
  );
}
