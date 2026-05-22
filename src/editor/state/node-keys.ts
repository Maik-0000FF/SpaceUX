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
  return `sec-${counter++}`;
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
