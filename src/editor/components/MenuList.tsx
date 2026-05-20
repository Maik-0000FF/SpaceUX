// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from 'react';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { moveTarget } from '../state/reorder';
import { sectorKey } from '../state/sector-keys';
import { ringSectors } from '../state/selectors';

import styles from './MenuList.module.scss';

/**
 * Left sidebar: the sectors of the ring currently in view (top level, or
 * a submenu after drilling in). Clicking selects; the "›" button on a
 * submenu drills into it. "+ Add item" appends to the current ring.
 * Items reorder by drag-and-drop (with a drop-line showing where they'll
 * land) or by keyboard — Alt+↑/↓ on the focused item. Delete and the
 * breadcrumb live elsewhere (Properties / PreviewHeader).
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
  // Insertion gap (0..length) the dragged item would land in; drives the
  // drop-line. Null when not dragging.
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleAdd = (): void => {
    addSector(viewPath);
    const current = useMenuSettings.getState().config;
    if (current) selectSector(ringSectors(current, viewPath).length - 1);
  };

  // Move the item at `from` to `to`, keeping it selected so the edit flow
  // and Properties panel follow it. No-op for an out-of-range target.
  const move = (from: number, to: number): void => {
    if (to < 0 || to >= sectors.length || to === from) return;
    moveSector(viewPath, from, to);
    selectSector(to);
  };

  const handleDrop = (): void => {
    if (dragIndex !== null && dropIndex !== null) {
      const to = moveTarget(dragIndex, dropIndex);
      if (to !== null) move(dragIndex, to);
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Menu</div>
      {sectors.length === 0 ? (
        <p className={styles.empty}>{config ? 'No sectors configured.' : 'Loading…'}</p>
      ) : (
        <ul className={styles.list}>
          {sectors.map((sector, i) => {
            // Drop-line only where a drop would actually reorder: moveTarget
            // is null for the dragged item's own slot and the gap right after
            // it, so no accent bar paints on those no-op positions.
            const dropTo =
              dragIndex !== null && dropIndex !== null ? moveTarget(dragIndex, dropIndex) : null;
            const rowClass = [
              styles.row,
              dragIndex === i ? styles.dragging : '',
              dropTo !== null && dropIndex === i ? styles.dropBefore : '',
              dropTo !== null && dropIndex === sectors.length && i === sectors.length - 1
                ? styles.dropAfter
                : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              // Identity key (see sector-keys): survives reorder so React
              // reconciles by sector, not array position — which also keeps
              // keyboard focus on the moved item.
              <li
                key={sectorKey(sector)}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  // Below the row's midpoint → drop after it, else before.
                  setDropIndex(e.clientY > r.top + r.height / 2 ? i + 1 : i);
                }}
                onDrop={handleDrop}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                className={rowClass}
              >
                <button
                  type="button"
                  className={`${styles.item} ${selectedIndex === i ? styles.itemSelected : ''}`}
                  aria-current={selectedIndex === i ? 'true' : undefined}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onClick={() => selectSector(i)}
                  onKeyDown={(e) => {
                    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                      e.preventDefault();
                      move(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
                    }
                  }}
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
