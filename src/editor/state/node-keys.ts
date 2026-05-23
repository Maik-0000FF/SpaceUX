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
 * Default label for a freshly-added node, encoding its 1-based tree path so
 * every new item is unique and shows where it sits — e.g. path `[0]` → "Item
 * 1", `[2, 0]` → "Item 3.1", `[0, 1, 0]` → "Item 1.2.1". Set at creation; the
 * user renames freely afterwards (the label doesn't track later moves).
 */
export function defaultItemLabel(path: readonly number[]): string {
  return `Item ${path.map((i) => i + 1).join('.')}`;
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
