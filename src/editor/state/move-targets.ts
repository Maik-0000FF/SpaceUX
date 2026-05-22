// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { MAX_MENU_DEPTH, type MenuConfig, type MenuNode } from '@/shared/menu';

import { nodeAtPath } from './selectors';

/** `prefix` is a (non-strict) prefix of `path`. */
export function isPrefix(prefix: readonly number[], path: readonly number[]): boolean {
  return prefix.length <= path.length && prefix.every((v, i) => v === path[i]);
}

/** Two index paths are equal. */
export function eqPath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Nesting height of a node: 0 for a leaf, 1 + deepest branch otherwise. */
export function nodeHeight(node: MenuNode): number {
  if (!node.branches || node.branches.length === 0) return 0;
  return 1 + Math.max(...node.branches.map(nodeHeight));
}

/** A ring the selected node may be moved into. `path` is the ring path
 *  (`[]` = top level); `label` is its breadcrumb for the picker. */
export type MoveTarget = { path: number[]; label: string };

/**
 * Every ring the node at `fromPath` can be moved into: the root and each
 * submenu, minus its current ring (a no-op), minus its own subtree (a
 * cycle), and minus any ring too deep to hold the moved subtree without
 * exceeding MAX_MENU_DEPTH.
 */
export function moveTargets(config: MenuConfig, fromPath: readonly number[]): MoveTarget[] {
  if (fromPath.length === 0) return [];
  const moved = nodeAtPath(config, fromPath);
  if (!moved) return [];
  const height = nodeHeight(moved);
  const fromRing = fromPath.slice(0, -1);

  const targets: MoveTarget[] = [];
  const visit = (nodes: readonly MenuNode[], ringPath: number[], labels: string[]): void => {
    const eligible =
      !eqPath(ringPath, fromRing) && // not the current ring (no-op)
      !isPrefix(fromPath, ringPath) && // not inside the moved subtree (cycle)
      ringPath.length + height <= MAX_MENU_DEPTH; // fits the depth cap
    if (eligible) {
      targets.push({
        path: [...ringPath],
        label: labels.length ? labels.join(' › ') : 'Top level',
      });
    }
    nodes.forEach((node, i) => {
      if (node.branches && node.branches.length > 0) {
        visit(node.branches, [...ringPath, i], [...labels, node.label]);
      }
    });
  };
  visit(config.root.branches ?? [], [], []);
  return targets;
}

/**
 * Index path to the node carrying `id`, or null. Used to re-locate a
 * node by its stable id after a move, since index paths shift when a
 * shared ancestor ring is spliced.
 */
export function pathOfNodeId(config: MenuConfig, id: string): number[] | null {
  const search = (nodes: readonly MenuNode[], prefix: number[]): number[] | null => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node.id === id) return [...prefix, i];
      if (node.branches) {
        const found = search(node.branches, [...prefix, i]);
        if (found) return found;
      }
    }
    return null;
  };
  return search(config.root.branches ?? [], []);
}
