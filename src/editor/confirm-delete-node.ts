// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenuNode } from '@/shared/menu';

import { confirm } from './state/confirm';

/** Count every descendant a node takes with it when its subtree is dropped
 *  (all nodes below it, not counting the node itself). */
export function countDescendants(node: Pick<MenuNode, 'branches'>): number {
  return (node.branches ?? []).reduce((n, child) => n + 1 + countDescendants(child), 0);
}

/**
 * Confirm an operation that drops a submenu's whole subtree: deleting it (#79)
 * or switching its Type to Action (#145). A leaf, or an empty submenu, has
 * nothing to lose, so it proceeds without a prompt (a stray click is cheap and
 * Ctrl+Z covers it). Otherwise ask, naming the node and how many items go with
 * it. Returns true when the caller should proceed.
 */
function confirmSubtreeLoss(
  node: Pick<MenuNode, 'label' | 'branches'>,
  verb: string,
  title: string,
): Promise<boolean> {
  const count = countDescendants(node);
  if (count === 0) return Promise.resolve(true);
  const name = node.label ? `"${node.label}"` : 'this submenu';
  const items = count === 1 ? '1 item' : `${count} items`;
  return confirm({
    title,
    message: `${verb} ${name} and its ${items}?`,
    confirmLabel: verb,
    destructive: true,
  });
}

/** Confirm deleting a node (the tree's 🗑 / the Properties delete button). */
export function confirmDeleteNode(node: Pick<MenuNode, 'label' | 'branches'>): Promise<boolean> {
  return confirmSubtreeLoss(node, 'Delete', 'Delete submenu?');
}

/** Confirm discarding a submenu's children when switching its Type to Action. */
export function confirmDiscardChildren(
  node: Pick<MenuNode, 'label' | 'branches'>,
): Promise<boolean> {
  return confirmSubtreeLoss(node, 'Discard', 'Discard submenu?');
}
