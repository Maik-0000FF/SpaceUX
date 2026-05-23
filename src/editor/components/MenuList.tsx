// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import type { MenuNode } from '@/shared/menu';

import { useAppState } from '../state/app-state';
import { useMenuSettings } from '../state/menu-settings';
import { moveTarget } from '../state/reorder';
import { nextNodeId, nodeKey, uniqueItemLabel } from '../state/node-keys';
import { ringBranches } from '../state/selectors';

import styles from './MenuList.module.scss';

/** Two index paths point at the same ring/node. */
function eqPath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Stable key for the root row (the centre). The root has no node id. */
const ROOT_KEY = '__root__';

/** One visible row in tree order — drives arrow-key navigation. */
type VisRow = {
  key: string;
  isRoot: boolean;
  /** This row's index path (root: []). */
  path: number[];
  /** The ring this row lives in (root + top-level rows: []). */
  ringPath: number[];
  isBranch: boolean;
  isOpen: boolean;
};

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
  const openNode = useAppState((s) => s.openNode);
  const selectCenter = useAppState((s) => s.selectCenter);
  const centerSelected = useAppState((s) => s.centerSelected);

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
        s.branches = [{ label: uniqueItemLabel(path, []), id: nextNodeId() }];
      });
    }
    // Dive into the node so the preview shows its children (the active
    // ring) — like the overlay drilling in — and a repeated ＋ adds more
    // siblings into the same ring.
    openNode(path);
    setExpanded((prev) => new Set(prev).add(key));
  };

  const removeItem = (ring: number[], index: number, ringLen: number): void => {
    // Deleting the last child of a *submenu* would leave it empty (invalid),
    // so instead drop the submenu level: the parent (at `ring`) becomes a
    // plain leaf again. The top-level ring (ring []) is exempt — it can be
    // emptied down to just the centre, so it deletes normally below.
    if (ring.length > 0 && ringLen <= 1) {
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

  // ── Keyboard tree navigation (WAI-ARIA tree pattern) ───────────────
  // `visible` is the flat list of rows in tree order (root first, then the
  // expanded branches), filled alongside the row JSX below. Arrow keys move
  // focus through it; reorder stays on Alt+↑/↓, and the per-row buttons stay
  // in the tab order so add/rename/delete remain keyboard-reachable.
  const visible: VisRow[] = [];
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const setRowRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  };
  const focusKey = (key: string | undefined): void => {
    if (key !== undefined) rowRefs.current.get(key)?.focus();
  };
  const parentRow = (r: VisRow): VisRow | undefined =>
    r.ringPath.length === 0
      ? visible.find((p) => p.isRoot)
      : visible.find((p) => !p.isRoot && eqPath(p.path, r.ringPath));
  // Returns true if it handled the key (caller then prevents default).
  const treeNav = (e: ReactKeyboardEvent, key: string): boolean => {
    const vi = visible.findIndex((r) => r.key === key);
    if (vi < 0) return false;
    const r = visible[vi]!;
    switch (e.key) {
      case 'ArrowDown':
        focusKey(visible[Math.min(vi + 1, visible.length - 1)]?.key);
        return true;
      case 'ArrowUp':
        focusKey(visible[Math.max(vi - 1, 0)]?.key);
        return true;
      case 'Home':
        focusKey(visible[0]?.key);
        return true;
      case 'End':
        focusKey(visible[visible.length - 1]?.key);
        return true;
      case 'ArrowRight':
        // Collapsed branch → expand; open branch (incl. root) → first child.
        if (r.isBranch && !r.isOpen && !r.isRoot) toggle(r.key);
        else if (r.isBranch) {
          const child = visible[vi + 1];
          if (child && eqPath(child.ringPath, r.path)) focusKey(child.key);
        }
        return true;
      case 'ArrowLeft':
        // Open branch → collapse; otherwise → focus the parent row.
        if (r.isBranch && r.isOpen && !r.isRoot) toggle(r.key);
        else focusKey(parentRow(r)?.key);
        return true;
      default:
        return false;
    }
  };

  const rows: ReactNode[] = [];
  const walk = (nodes: readonly MenuNode[], ringPath: number[], depth: number): void => {
    const ringLen = nodes.length;
    nodes.forEach((node, i) => {
      const path = [...ringPath, i];
      const key = nodeKey(node);
      const isBranch = node.branches !== undefined && node.branches.length > 0;
      const isOpen = expanded.has(key);
      // Highlighted when it's the in-ring selection, or when it's the
      // branch we've drilled into (its own path == the view path).
      const selected =
        (eqPath(ringPath, viewPath) && selectedIndex === i) ||
        (selectedIndex === null && eqPath(path, viewPath));
      const inDragRing = drag !== null && eqPath(drag.ring, ringPath);
      const dragging = inDragRing && drag.index === i;
      const showDrop =
        inDragRing && dropIndex !== null && moveTarget(drag.index, dropIndex) !== null;
      const isRenaming = renaming === key;
      visible.push({ key, isRoot: false, path, ringPath, isBranch, isOpen });

      rows.push(
        <li
          key={key}
          role="none"
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
                ref={setRowRef(key)}
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={isBranch ? isOpen : undefined}
                aria-selected={selected}
                aria-setsize={ringLen}
                aria-posinset={i + 1}
                className={`${styles.item} ${selected ? styles.itemSelected : ''}`}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Alt+ArrowUp Alt+ArrowDown"
                title={node.label}
                onClick={() => (isBranch ? openNode(path) : selectPath(path))}
                // Double-click the label to rename inline — single click still
                // opens/selects; the ✎ button does the same.
                onDoubleClick={() => {
                  renameCancelled.current = false;
                  setRenaming(key);
                  setRenameValue(node.label);
                }}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    moveWithin(ringPath, i, e.key === 'ArrowUp' ? i - 1 : i + 1, ringLen);
                  } else if (treeNav(e, key)) {
                    e.preventDefault();
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
                      ? 'Delete (leaves just the centre)'
                      : ringLen <= 1
                        ? 'Delete (turns the parent back into a normal item)'
                        : 'Delete'
                  }
                  aria-label={`Delete ${node.label}`}
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
  // Root row first (tree order), then its branches one level in.
  if (config) {
    visible.push({
      key: ROOT_KEY,
      isRoot: true,
      path: [],
      ringPath: [],
      isBranch: true,
      isOpen: true,
    });
    walk(config.root.branches ?? [], [], 1);
  }
  const rootLabel = config?.root.label?.trim() ? config.root.label : 'Center';

  return (
    <aside className={styles.sidebar}>
      <div className={styles.headingRow}>
        <span className={styles.heading}>Menu</span>
      </div>
      {!config ? (
        <p className={styles.empty}>Loading…</p>
      ) : (
        <ul className={styles.list} role="tree" aria-label="Menu">
          {/* Root row = the centre of the pie; the top-level ring is its
              children, indented below. Selecting it edits the root
              (label + action); ＋ adds a top-level node. Not draggable,
              renamable, or deletable — the menu always has a root. */}
          <li
            role="none"
            style={{ paddingLeft: 8 }}
            className={[styles.row, centerSelected ? styles.rowSelected : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.rootCaret} aria-hidden="true">
              ▾
            </span>
            <button
              type="button"
              ref={setRowRef(ROOT_KEY)}
              role="treeitem"
              aria-level={1}
              aria-expanded={true}
              aria-selected={centerSelected}
              className={`${styles.item} ${centerSelected ? styles.itemSelected : ''}`}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowRight"
              title="Center (root) — the pie's centre"
              onClick={selectCenter}
              onKeyDown={(e) => {
                if (treeNav(e, ROOT_KEY)) e.preventDefault();
              }}
            >
              {rootLabel}
            </button>
            <span className={`${styles.actions} ${styles.actionsAlways}`}>
              <button
                type="button"
                className={styles.actionBtn}
                title="Add top-level node"
                aria-label="Add top-level node"
                onClick={addTopLevel}
              >
                ＋
              </button>
            </span>
          </li>
          {rows}
        </ul>
      )}
    </aside>
  );
}
