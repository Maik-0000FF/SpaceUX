// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenuNode } from '@/shared/menu';

let counter = 0;

/**
 * Mint a fresh editor-only node id. The menu-settings store stamps these
 * onto nodes when a config is adopted and onto newly-added nodes, so
 * every node the editor renders carries one.
 */
export function nextNodeId(): string {
  return `node-${counter++}`;
}

/**
 * Default label for a freshly-added node: "Item " + the 1-based path of its
 * ring (just "Item " at the top level) + the next free number in that ring.
 * The number is one past the highest "Item <prefix>N" already present, so a
 * new item never collides with a sibling — even after deletions reshuffle
 * the indices (a plain position index would reuse a number an undeleted
 * sibling still holds). User-renamed siblings are ignored for numbering.
 * Shows roughly where the item sits; the user renames freely afterwards.
 *
 * @param ringPath 1-based-encoded by this fn; `[]` = the top-level ring.
 * @param siblingLabels labels already in that ring.
 */
export function uniqueItemLabel(
  ringPath: readonly number[],
  siblingLabels: readonly string[],
): string {
  const prefix = ringPath.map((i) => i + 1).join('.');
  const head = prefix ? `Item ${prefix}.` : 'Item ';
  let max = 0;
  for (const label of siblingLabels) {
    if (label.startsWith(head)) {
      const rest = label.slice(head.length);
      if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
    }
  }
  return `${head}${max + 1}`;
}

/**
 * Whether a label still looks auto-generated (never customised): empty, the
 * legacy "New item", or the "Item <n.n…>" path scheme. Lets the cancel-label
 * helper fill a name onto an untouched node without clobbering a real one.
 */
export function isDefaultItemLabel(label: string): boolean {
  return label === '' || label === 'New item' || /^Item \d+(\.\d+)*$/.test(label);
}

// Fallback identity for nodes that never went through the store (ad-hoc
// test/screenshot data). Keyed on object identity, so it does NOT survive
// immer copies — only the persisted `id` does.
const weak = new WeakMap<MenuNode, string>();

/**
 * Stable React/identity key for a node.
 *
 * Prefers the editor-only `id` (see MenuNode.id): because it lives on
 * the object, immer copies it across edits and reorders, so the key — and
 * anything keyed on it, like the tree's expand state — survives a
 * copy-on-write that replaces the object. Falls back to a WeakMap for
 * id-less nodes that never passed through the store.
 */
export function nodeKey(node: MenuNode): string {
  if (node.id !== undefined) return node.id;
  let key = weak.get(node);
  if (key === undefined) {
    key = `weak-${counter++}`;
    weak.set(node, key);
  }
  return key;
}
