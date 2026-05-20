// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, type ReactNode } from 'react';

import type { MenuSector } from '@/shared/menu';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { moveTarget } from '../state/reorder';
import { sectorKey } from '../state/sector-keys';
import { ringSectors } from '../state/selectors';

import styles from './MenuList.module.scss';

/** Two index paths point at the same ring/node. */
function eqPath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Left sidebar: the whole menu as an expandable tree. Each row is one
 * sector, indented by depth; branches get a ▸/▾ toggle. Clicking a row
 * jumps to it — its parent ring becomes the preview's view and the row
 * its selection (so any nested item is one click away). Reorder works
 * within a ring (siblings only): drag with a drop-line, or Alt+↑/↓ on the
 * focused row. "+ Add item" appends to the ring of the current selection.
 * Cross-ring moves are a separate concern (#55).
 */
export function MenuList() {
  const config = useMenuSettings((s) => s.config);
  const addSector = useMenuSettings((s) => s.addSector);
  const moveSector = useMenuSettings((s) => s.moveSector);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectPath = useAppState((s) => s.selectPath);

  // Expand/collapse keyed on sector identity (sectorKey) so the state
  // survives reorder; an edited branch (new immer object) re-collapses,
  // which is harmless.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Sibling drag: the dragged node's ring + index, plus the hovered
  // insertion gap within that same ring (drag is confined to one ring).
  const [drag, setDrag] = useState<{ ring: number[]; index: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const endDrag = (): void => {
    setDrag(null);
    setDropIndex(null);
  };

  // Move within a ring, keeping the moved node selected. No-op for an
  // out-of-range target.
  const moveWithin = (ring: number[], from: number, to: number, ringLen: number): void => {
    if (to < 0 || to >= ringLen || to === from) return;
    moveSector(ring, from, to);
    selectPath([...ring, to]);
  };

  const handleDrop = (): void => {
    if (drag && dropIndex !== null) {
      const to = moveTarget(drag.index, dropIndex);
      if (to !== null) {
        moveSector(drag.ring, drag.index, to);
        selectPath([...drag.ring, to]);
      }
    }
    endDrag();
  };

  const handleAdd = (): void => {
    addSector(viewPath);
    const current = useMenuSettings.getState().config;
    if (current) selectPath([...viewPath, ringSectors(current, viewPath).length - 1]);
  };

  const rows: ReactNode[] = [];
  const walk = (sectors: readonly MenuSector[], ringPath: number[], depth: number): void => {
    const ringLen = sectors.length;
    sectors.forEach((sector, i) => {
      const path = [...ringPath, i];
      const key = sectorKey(sector);
      const isBranch = sector.children !== undefined && sector.children.length > 0;
      const isOpen = expanded.has(key);
      const selected = eqPath(ringPath, viewPath) && selectedIndex === i;
      const inDragRing = drag !== null && eqPath(drag.ring, ringPath);
      const dragging = inDragRing && drag.index === i;
      // Drop-line only on the dragged node's siblings, and only where a
      // drop would actually reorder (moveTarget !== null on no-op gaps).
      const showDrop =
        inDragRing && dropIndex !== null && moveTarget(drag.index, dropIndex) !== null;

      rows.push(
        <li
          key={key}
          draggable
          onDragStart={() => setDrag({ ring: ringPath, index: i })}
          onDragOver={(e) => {
            if (!inDragRing) return; // siblings only
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setDropIndex(e.clientY > r.top + r.height / 2 ? i + 1 : i);
          }}
          onDrop={(e) => {
            if (!inDragRing) return;
            e.preventDefault();
            handleDrop();
          }}
          onDragEnd={endDrag}
          style={{ paddingLeft: 8 + depth * 14 }}
          className={[
            styles.row,
            dragging ? styles.dragging : '',
            showDrop && dropIndex === i ? styles.dropBefore : '',
            showDrop && dropIndex === ringLen && i === ringLen - 1 ? styles.dropAfter : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {isBranch ? (
            <button
              type="button"
              className={styles.chevron}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${sector.label}`}
              onClick={() => toggle(key)}
            >
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className={styles.chevronSpacer} aria-hidden="true" />
          )}
          <button
            type="button"
            className={`${styles.item} ${selected ? styles.itemSelected : ''}`}
            aria-current={selected ? 'true' : undefined}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            onClick={() => selectPath(path)}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                moveWithin(ringPath, i, e.key === 'ArrowUp' ? i - 1 : i + 1, ringLen);
              }
            }}
          >
            {sector.label}
          </button>
        </li>,
      );

      if (isBranch && isOpen) walk(sector.children!, path, depth + 1);
    });
  };
  if (config) walk(config.sectors, [], 0);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>Menu</div>
      {!config ? (
        <p className={styles.empty}>Loading…</p>
      ) : config.sectors.length === 0 ? (
        <p className={styles.empty}>No sectors configured.</p>
      ) : (
        <ul className={styles.list}>{rows}</ul>
      )}
      {config !== null && (
        <button type="button" className={styles.addButton} onClick={handleAdd}>
          + Add item
        </button>
      )}
    </aside>
  );
}
