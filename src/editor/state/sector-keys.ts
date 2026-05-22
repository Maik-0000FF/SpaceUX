// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenuNode } from '@/shared/menu';

let counter = 0;

/**
 * Mint a fresh editor-only sector id. The menu-settings store stamps these
 * onto sectors when a config is adopted and onto newly-added sectors, so
 * every sector the editor renders carries one.
 */
export function nextSectorId(): string {
  return `sec-${counter++}`;
}

// Fallback identity for sectors that never went through the store (ad-hoc
// test/screenshot data). Keyed on object identity, so it does NOT survive
// immer copies — only the persisted `id` does.
const weak = new WeakMap<MenuNode, string>();

/**
 * Stable React/identity key for a sector.
 *
 * Prefers the editor-only `id` (see MenuNode.id): because it lives on
 * the object, immer copies it across edits and reorders, so the key — and
 * anything keyed on it, like the tree's expand state — survives a
 * copy-on-write that replaces the object. Falls back to a WeakMap for
 * id-less sectors that never passed through the store.
 */
export function sectorKey(sector: MenuNode): string {
  if (sector.id !== undefined) return sector.id;
  let key = weak.get(sector);
  if (key === undefined) {
    key = `weak-${counter++}`;
    weak.set(sector, key);
  }
  return key;
}
