// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { currentBranches } from '@/core/menu-nav';
import type { MenuConfig, MenuNode } from '@/shared/menu';

import { nodeKey } from './node-keys';

/**
 * Resolve the node an index path points at, or null when the path is
 * empty or *any* segment is stale — including a stale parent (a path
 * that drilled through a submenu a reload turned into a leaf). This walks
 * explicitly rather than via `currentBranches` (which falls back to the
 * root ring on a broken parent), so a stale `[9, 0]` yields null instead
 * of silently resolving to root branch 0.
 */
export function nodeAtPath(config: MenuConfig, path: readonly number[]): MenuNode | null {
  if (path.length === 0) return null;
  let ring: MenuNode[] = config.root.branches ?? [];
  for (let k = 0; k < path.length - 1; k++) {
    const next = ring[path[k]!]?.branches;
    if (!next) return null; // stale parent segment
    ring = next;
  }
  return ring[path[path.length - 1]!] ?? null;
}

/**
 * Where the selection should land after `deleteOrCollapseNode(ring, index)`
 * has mutated `after`. The rule is the same for both branches the action
 * picks: focus a neighbour in the still-populated ring, or fall back to the
 * ring path itself (the now-leaf parent when the submenu collapsed, or the
 * centre when the root ring emptied).
 *
 * This must NOT go through `currentBranches`. That helper falls back to the
 * root ring when a path segment hits a leaf, which makes a collapsed submenu
 * look like a populated root ring and would steer the selection into the
 * just-removed subtree. Resolve the parent directly with `nodeAtPath` (or
 * the root for an empty ring path) and read its `branches` length.
 */
export function nextSelectionAfterDelete(
  after: MenuConfig,
  ring: readonly number[],
  index: number,
): number[] {
  const parent = ring.length === 0 ? after.root : nodeAtPath(after, ring);
  const remaining = parent?.branches?.length ?? 0;
  if (remaining === 0) return [...ring];
  return [...ring, Math.min(index, remaining - 1)];
}

/** Full index path to the selected node, or null when nothing is
 *  selected. Combines the view path with the in-ring selection. */
export function selectedPath(
  viewPath: readonly number[],
  selectedIndex: number | null,
): number[] | null {
  return selectedIndex === null ? null : [...viewPath, selectedIndex];
}

/**
 * Nodes of the ring currently in view. Reuses the renderer's
 * `currentBranches` so editor and pie agree on path semantics.
 *
 * Stale-path behaviour differs from `nodeAtPath` (which returns null)
 * by design: `currentBranches` falls back to the *root* ring on a stale
 * `viewPath`. We rely on `viewPath` never being stale rather than
 * reconciling the two: `adopt()` resets it to root on every external
 * reload, and a local edit can't orphan it (you can't turn the submenu
 * you're standing inside into a leaf — its row isn't in the ring you're
 * viewing). If that invariant is ever weakened, these consumers must be
 * unified.
 */
export function ringBranches(config: MenuConfig, viewPath: readonly number[]): MenuNode[] {
  return currentBranches(config, viewPath);
}

/**
 * `nodeKey` of the last row `node` contributes to the flattened tree given the
 * current `expanded` set: the node itself when collapsed or a leaf, otherwise
 * the last visible descendant of its last expanded branch.
 *
 * The drop-line for the gap after a ring's final sibling must land below that
 * sibling's whole block, not between its row and its first child — so it
 * anchors to this key rather than the sibling row.
 */
export function lastVisibleNodeKey(node: MenuNode, expanded: ReadonlySet<string>): string {
  let cur = node;
  while (cur.branches?.length && expanded.has(nodeKey(cur))) {
    cur = cur.branches[cur.branches.length - 1]!;
  }
  return nodeKey(cur);
}
