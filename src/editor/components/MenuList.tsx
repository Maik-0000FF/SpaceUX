// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, type ReactNode } from 'react';

import type { MenuSector } from '@/shared/menu';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { moveTarget } from '../state/reorder';
import { nextSectorId, sectorKey } from '../state/sector-keys';
import { ringSectors } from '../state/selectors';

import styles from './MenuList.module.scss';

/** Two index paths point at the same ring/node. */
function eqPath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Left sidebar: the whole menu as an expandable tree. Each row is one
 * sector, indented by depth; branches get a ▸/▾ toggle. Clicking a row
 * jumps to it (parent ring → preview view, row → selection), so any nested
 * item is one click away.
 *
 * Per-row actions (shown on the selected/hovered row): ＋ adds — a child
 * into a branch (revealed by expanding it) or a sibling right below a leaf;
 * ✎ renames inline; 🗑 deletes (disabled when it would empty a ring). The
 * "+" in the header adds a top-level item. Reorder works within a ring
 * (siblings only): drag with a drop-line, or Alt+↑/↓ on the focused row.
 * Cross-ring moves are a separate concern (#55).
 */
export function MenuList() {
  const config = useMenuSettings((s) => s.config);
  const addSector = useMenuSettings((s) => s.addSector);
  const moveSector = useMenuSettings((s) => s.moveSector);
  const deleteSector = useMenuSettings((s) => s.deleteSector);
  const updateSectorAt = useMenuSettings((s) => s.updateSectorAt);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectPath = useAppState((s) => s.selectPath);

  // Expand/collapse keyed on sector identity (sectorKey → stable id) so the
  // state survives reorder and edit.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Sibling drag: the dragged node's ring + index, plus the hovered
  // insertion gap within that same ring (drag is confined to one ring).
  const [drag, setDrag] = useState<{ ring: number[]; index: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Inline rename: the sectorKey of the row being renamed + its draft text.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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

  // Add a child into the node and reveal it. A leaf becomes a submenu —
  // its action is dropped and one child seeded, exactly like the
  // Type→Submenu switch in Properties. To add a sibling, use the parent's
  // ＋ (or the header ＋ for a top-level item).
  const addItem = (path: number[], isBranch: boolean, key: string): void => {
    if (isBranch) {
      addSector(path);
      const after = useMenuSettings.getState().config;
      if (after) selectPath([...path, ringSectors(after, path).length - 1]);
    } else {
      updateSectorAt(path, (s) => {
        delete s.binding;
        s.children = [{ label: 'New item', id: nextSectorId() }];
      });
      selectPath([...path, 0]);
    }
    setExpanded((prev) => new Set(prev).add(key));
  };

  const removeItem = (ring: number[], index: number, ringLen: number): void => {
    // Deleting the last child of a submenu would leave it empty (invalid),
    // so instead drop the submenu level: the parent (at `ring`) becomes a
    // plain leaf again. The root ring can't shrink to empty — its last
    // item's delete button is disabled, so `ring` is non-empty here.
    if (ringLen <= 1) {
      updateSectorAt(ring, (s) => {
        delete s.children;
      });
      selectPath(ring);
      return;
    }
    deleteSector(ring, index);
    const after = useMenuSettings.getState().config;
    const remaining = after ? ringSectors(after, ring).length : 0;
    selectPath(remaining > 0 ? [...ring, Math.min(index, remaining - 1)] : []);
  };

  const addTopLevel = (): void => {
    addSector([]);
    const after = useMenuSettings.getState().config;
    if (after) selectPath([after.sectors.length - 1]);
  };

  const commitRename = (path: number[]): void => {
    const value = renameValue.trim();
    if (value)
      updateSectorAt(path, (s) => {
        s.label = value;
      });
    setRenaming(null);
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
      const showDrop =
        inDragRing && dropIndex !== null && moveTarget(drag.index, dropIndex) !== null;
      const isRenaming = renaming === key;

      rows.push(
        <li
          key={key}
          draggable={!isRenaming}
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
            selected ? styles.rowSelected : '',
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

          {isRenaming ? (
            <input
              className={styles.rename}
              value={renameValue}
              autoFocus
              aria-label={`Rename ${sector.label}`}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename(path);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenaming(null);
                }
              }}
            />
          ) : (
            <>
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
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title="Add child"
                  aria-label={`Add child to ${sector.label}`}
                  onClick={() => addItem(path, isBranch, key)}
                >
                  ＋
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title="Rename"
                  aria-label={`Rename ${sector.label}`}
                  onClick={() => {
                    setRenaming(key);
                    setRenameValue(sector.label);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title={
                    ringPath.length === 0 && ringLen <= 1
                      ? 'A menu must keep at least one item'
                      : ringLen <= 1
                        ? 'Delete (turns the parent back into a normal item)'
                        : 'Delete'
                  }
                  aria-label={`Delete ${sector.label}`}
                  disabled={ringPath.length === 0 && ringLen <= 1}
                  onClick={() => removeItem(ringPath, i, ringLen)}
                >
                  🗑
                </button>
              </span>
            </>
          )}
        </li>,
      );

      if (isBranch && isOpen) walk(sector.children!, path, depth + 1);
    });
  };
  if (config) walk(config.sectors, [], 0);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.headingRow}>
        <span className={styles.heading}>Menu</span>
        {config !== null && (
          <button
            type="button"
            className={styles.headingAdd}
            title="Add top-level item"
            aria-label="Add top-level item"
            onClick={addTopLevel}
          >
            ＋
          </button>
        )}
      </div>
      {!config ? (
        <p className={styles.empty}>Loading…</p>
      ) : config.sectors.length === 0 ? (
        <p className={styles.empty}>No sectors configured.</p>
      ) : (
        <ul className={styles.list}>{rows}</ul>
      )}
    </aside>
  );
}
