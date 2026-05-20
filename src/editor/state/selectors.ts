// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { currentSectors } from '@/core/menu-nav';
import type { MenuConfig, MenuSector } from '@/shared/menu';

/**
 * Resolve the sector an index path points at, or null when the path is
 * empty or *any* segment is stale — including a stale parent (a path
 * that drilled through a branch a reload turned into a leaf). This walks
 * explicitly rather than via `currentSectors` (which falls back to the
 * root ring on a broken parent), so a stale `[9, 0]` yields null instead
 * of silently resolving to root sector 0.
 */
export function sectorAtPath(config: MenuConfig, path: readonly number[]): MenuSector | null {
  if (path.length === 0) return null;
  let ring: MenuSector[] = config.sectors;
  for (let k = 0; k < path.length - 1; k++) {
    const next = ring[path[k]!]?.children;
    if (!next) return null; // stale parent segment
    ring = next;
  }
  return ring[path[path.length - 1]!] ?? null;
}

/** Full index path to the selected sector, or null when nothing is
 *  selected. Combines the view path with the in-ring selection. */
export function selectedPath(
  viewPath: readonly number[],
  selectedIndex: number | null,
): number[] | null {
  return selectedIndex === null ? null : [...viewPath, selectedIndex];
}

/** Sectors of the ring currently in view. Reuses the renderer's
 *  `currentSectors` so editor and pie agree on path semantics. */
export function ringSectors(config: MenuConfig, viewPath: readonly number[]): MenuSector[] {
  return currentSectors(config, viewPath);
}

/** Labels of the drilled-into sectors along `viewPath` (excludes the
 *  implicit root). Drives the breadcrumb. Stops early on a stale path. */
export function breadcrumbLabels(config: MenuConfig, viewPath: readonly number[]): string[] {
  const labels: string[] = [];
  let ring: MenuSector[] = config.sectors;
  for (const i of viewPath) {
    const sector = ring[i];
    if (!sector) break;
    labels.push(sector.label);
    if (!sector.children) break;
    ring = sector.children;
  }
  return labels;
}
