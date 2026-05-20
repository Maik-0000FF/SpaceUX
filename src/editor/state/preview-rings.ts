// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { sectorCenterAngle } from '@/core/pie-geometry';
import type { MenuConfig, MenuSector } from '@/shared/menu';

/** One concentric ring of the stacked-ring preview. */
export type PreviewRing = {
  sectors: readonly MenuSector[];
  /** Index path to this ring (the moveSector ring path); `[]` for root. */
  basePath: number[];
  /** Sector on the selected path within this ring, or null. */
  selectedIndex: number | null;
  /** Cumulative rotation so each ring's children fan out from their parent
   *  sector, matching the live pie's preview-ring rotation. */
  rotation: number;
};

/**
 * Walk from the root following `path`, collecting one ring per level plus,
 * when the deepest selected sector is a branch, its children as the
 * outermost ring. Pure geometry/navigation logic, kept out of the view so
 * it can be unit-tested.
 */
export function buildRings(config: MenuConfig, path: readonly number[]): PreviewRing[] {
  const rings: PreviewRing[] = [];
  let sectors: readonly MenuSector[] = config.sectors;
  let rotation = 0;
  for (let depth = 0; ; depth++) {
    const selectedIndex = depth < path.length ? path[depth]! : null;
    rings.push({ sectors, basePath: path.slice(0, depth), selectedIndex, rotation });
    if (selectedIndex === null) break;
    const sel = sectors[selectedIndex];
    if (!sel?.children || sel.children.length === 0) break;
    rotation += sectorCenterAngle(selectedIndex, sectors.length);
    sectors = sel.children;
  }
  return rings;
}
