// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { MenuNode } from '@/shared/menu';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { moveTarget } from '../state/reorder';
import { nextNodeId, nodeKey } from '../state/node-keys';
import { ringBranches } from '../state/selectors';

import styles from './MenuList.module.scss';

/** Two index paths point at the same ring/node. */
function eqPath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Left sidebar: the whole menu as an expandable tree. Each row is one
 * node, indented by depth; branches get a ▸/▾ toggle. Clicking a row
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
  const addNode = useMenuSettings((s) => s.addNode);
  const moveNode = useMenuSettings((s) => s.moveNode);
  const deleteNode = useMenuSettings((s) => s.deleteNode);
  const updateNodeAt = useMenuSettings((s) => s.updateNodeAt);
  const viewPath = useAppState((s) => s.viewPath);
  const selectedIndex = useAppState((s) => s.selectedIndex);
  const selectPath = useAppState((s) => s.selectPath);

  // Expand/collapse keyed on node identity (nodeKey → stable id) so the
  // state survives reorder and edit.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Sibling drag: the dragged node's ring + index, plus the hovered
  // insertion gap within that same ring (drag is confined to one ring).
  const [drag, setDrag] = useState<{ ring: number[]; index: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Inline rename: the nodeKey of the row being renamed + its draft text.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Set on Escape so the blur that fires when the input unmounts can't
  // re-commit the cancelled edit (the onBlur→commit / Escape→cancel race).
  const renameCancelled = useRef(false);

  // Reveal the current selection: expand every ancestor along viewPath so a
  // node selected elsewhere (e.g. by clicking a wedge in the preview) shows
  // up as a visible, highlighted row in the tree.
  useEffect(() => {
    if (!config) return;
    const ancestors: string[] = [];
    let ring: readonly MenuNode[] = config.root.branches ?? [];
    for (const idx of viewPath) {
      const node = ring[idx];
      if (!node) break;
      ancestors.push(nodeKey(node));
      if (!node.branches) break;
      ring = node.branches;
    }
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const k of ancestors)
        if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
      return changed ? next : prev;
    });
  }, [config, viewPath]);

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
    moveNode(ring, from, to);
    selectPath([...ring, to]);
  };

  const handleDrop = (): void => {
    if (drag && dropIndex !== null) {
      const to = moveTarget(drag.index, dropIndex);
      if (to !== null) {
        moveNode(drag.ring, drag.index, to);
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
      addNode(path);
    } else {
      updateNodeAt(path, (s) => {
        delete s.action;
        s.branches = [{ label: 'New item', id: nextNodeId() }];
      });
    }
    // Keep the *branch* selected (not the new child) so repeated ＋ adds
    // more children into the same ring — and the preview shows them as the
    // segmented outer ring — instead of selecting a leaf (no ring) or
    // nesting one level deeper on the next ＋.
    selectPath(path);
    setExpanded((prev) => new Set(prev).add(key));
  };

  const removeItem = (ring: number[], index: number, ringLen: number): void => {
    // Deleting the last child of a submenu would leave it empty (invalid),
    // so instead drop the submenu level: the parent (at `ring`) becomes a
    // plain leaf again. The root ring can't shrink to empty — its last
    // item's delete button is disabled, so `ring` is non-empty here.
    if (ringLen <= 1) {
      updateNodeAt(ring, (s) => {
        delete s.branches;
      });
      selectPath(ring);
      return;
    }
    deleteNode(ring, index);
    const after = useMenuSettings.getState().config;
    const remaining = after ? ringBranches(after, ring).length : 0;
    selectPath(remaining > 0 ? [...ring, Math.min(index, remaining - 1)] : []);
  };

  const addTopLevel = (): void => {
    addNode([]);
    const after = useMenuSettings.getState().config;
    if (after) selectPath([(after.root.branches?.length ?? 0) - 1]);
  };

  const commitRename = (path: number[]): void => {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    const value = renameValue.trim();
    if (value)
      updateNodeAt(path, (s) => {
        s.label = value;
      });
    setRenaming(null);
  };

  const rows: ReactNode[] = [];
  const walk = (nodes: readonly MenuNode[], ringPath: number[], depth: number): void => {
    const ringLen = nodes.length;
    nodes.forEach((node, i) => {
      const path = [...ringPath, i];
      const key = nodeKey(node);
      const isBranch = node.branches !== undefined && node.branches.length > 0;
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
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.label}`}
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
              aria-label={`Rename ${node.label}`}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename(path);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  renameCancelled.current = true;
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
                title={node.label}
                onClick={() => selectPath(path)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    moveWithin(ringPath, i, e.key === 'ArrowUp' ? i - 1 : i + 1, ringLen);
                  }
                }}
              >
                {node.label}
              </button>
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title="Add child"
                  aria-label={`Add child to ${node.label}`}
                  onClick={() => addItem(path, isBranch, key)}
                >
                  ＋
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  title="Rename"
                  aria-label={`Rename ${node.label}`}
                  onClick={() => {
                    renameCancelled.current = false;
                    setRenaming(key);
                    setRenameValue(node.label);
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
                  aria-label={`Delete ${node.label}`}
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

      if (isBranch && isOpen) walk(node.branches!, path, depth + 1);
    });
  };
  if (config) walk(config.root.branches ?? [], [], 0);

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
      ) : (config.root.branches?.length ?? 0) === 0 ? (
        <p className={styles.empty}>No nodes configured.</p>
      ) : (
        <ul className={styles.list}>{rows}</ul>
      )}
    </aside>
  );
}
