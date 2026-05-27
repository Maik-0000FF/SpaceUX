// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenuNode } from '@/shared/menu';

import { confirm } from './state/confirm';

/** Count every descendant a node takes with it when deleted (all nodes in its
 *  subtree, not counting the node itself). */
export function countDescendants(node: Pick<MenuNode, 'branches'>): number {
  return (node.branches ?? []).reduce((n, child) => n + 1 + countDescendants(child), 0);
}

/**
 * Confirm a destructive node delete (#79). A leaf — or an empty submenu —
 * deletes without friction: a stray click is cheap and Ctrl+Z covers it. A
 * submenu with children asks first and names what goes with it, since the
 * delete drops the whole subtree, not just the one node. Returns true when the
 * caller should proceed.
 */
export function confirmDeleteNode(node: Pick<MenuNode, 'label' | 'branches'>): Promise<boolean> {
  const count = countDescendants(node);
  if (count === 0) return Promise.resolve(true);
  const name = node.label ? `"${node.label}"` : 'this submenu';
  const items = count === 1 ? '1 item' : `${count} items`;
  return confirm({
    title: 'Delete submenu?',
    message: `Delete ${name} and its ${items}?`,
    confirmLabel: 'Delete',
    destructive: true,
  });
}
