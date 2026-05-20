// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { currentSectors } from '@/core/menu-nav';
import type { MenuConfig, MenuSector } from '@/shared/menu';

/**
 * Resolve the sector a `selectedPath` points at, or null when the path
 * is empty or stale (e.g. it referenced a sector that a reload removed).
 *
 * Reuses the renderer's `currentSectors` walker so the editor and the
 * live pie agree on how an index path maps to a sector — the parent
 * ring is resolved from all but the last index, then the last index
 * picks the sector within it.
 */
export function sectorAtPath(config: MenuConfig, path: readonly number[]): MenuSector | null {
  if (path.length === 0) return null;
  const ring = currentSectors(config, path.slice(0, -1));
  return ring[path[path.length - 1]!] ?? null;
}
