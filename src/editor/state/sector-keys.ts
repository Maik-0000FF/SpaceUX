// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MenuSector } from '@/shared/menu';

/**
 * Stable React key for a sector, scoped to the editor session.
 *
 * Backed by a WeakMap keyed on the sector object's identity. Reorders
 * (`moveSector` splices the same object references, and immer leaves
 * untouched objects untouched) preserve identity, so React reconciles the
 * list/preview by identity instead of array position — that's the fix for
 * the `key={i}` reconciliation smell when sectors are added / deleted /
 * moved.
 *
 * A sector edited through the store is a *new* object (immer copy-on-
 * write), so it gets a fresh key and its row remounts. The rows are
 * stateless, the remount is invisible, and it only happens on edit — never
 * during a reorder, where keys must stay put.
 *
 * Transient by design: ids live only in memory, are never written to
 * menu.json, and are re-minted whenever a config is reloaded / adopted
 * (the adopted snapshot is a fresh set of objects).
 */
const keys = new WeakMap<MenuSector, string>();
let next = 0;

export function sectorKey(sector: MenuSector): string {
  let key = keys.get(sector);
  if (key === undefined) {
    key = `sec-${next++}`;
    keys.set(sector, key);
  }
  return key;
}
