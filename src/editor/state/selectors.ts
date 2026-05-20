// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { currentSectors } from '@/core/menu-nav';
import type { MenuConfig, MenuSector } from '@/shared/menu';

/**
 * Resolve the sector a `selectedPath` points at, reusing the renderer's
 * `currentSectors` walker so the editor and the live pie agree on how
 * an index path maps to a sector — the parent ring is resolved from all
 * but the last index, then the last index picks the sector within it.
 *
 * Returns null for an empty path or when the *final* index is out of
 * range. Note the asymmetry: a stale *parent* segment (a path that
 * drilled through a branch a reload turned into a leaf) does not yield
 * null — `currentSectors` falls back to the root ring in that case, so
 * e.g. `[9, 0]` resolves to root sector 0. That's harmless for
 * PR Editor-2, which only ever produces single-element paths, but the
 * nested selection in PR Editor-5 will need an explicit stale-path
 * guard here.
 */
export function sectorAtPath(config: MenuConfig, path: readonly number[]): MenuSector | null {
  if (path.length === 0) return null;
  const ring = currentSectors(config, path.slice(0, -1));
  return ring[path[path.length - 1]!] ?? null;
}

/**
 * Whether `path` selects exactly the top-level sector `index`. Single
 * source of truth for the selection check shared by MenuList and
 * MenuPreview; when nested selection lands (PR Editor-5) the
 * deeper-path comparison changes here only.
 */
export function isSelected(path: readonly number[], index: number): boolean {
  return path.length === 1 && path[0] === index;
}
