// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { MAX_MENU_DEPTH, type MenuConfig, type MenuSector } from '@/shared/menu';

import { sectorAtPath } from './selectors';

/** `prefix` is a (non-strict) prefix of `path`. */
export function isPrefix(prefix: readonly number[], path: readonly number[]): boolean {
  return prefix.length <= path.length && prefix.every((v, i) => v === path[i]);
}

/** Two index paths are equal. */
export function eqPath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Nesting height of a sector: 0 for a leaf, 1 + deepest child otherwise. */
export function sectorHeight(sector: MenuSector): number {
  if (!sector.children || sector.children.length === 0) return 0;
  return 1 + Math.max(...sector.children.map(sectorHeight));
}

/** A ring the selected sector may be moved into. `path` is the ring path
 *  (`[]` = top level); `label` is its breadcrumb for the picker. */
export type MoveTarget = { path: number[]; label: string };

/**
 * Every ring the sector at `fromPath` can be moved into: the root and each
 * submenu, minus its current ring (a no-op), minus its own subtree (a
 * cycle), and minus any ring too deep to hold the moved subtree without
 * exceeding MAX_MENU_DEPTH.
 */
export function moveTargets(config: MenuConfig, fromPath: readonly number[]): MoveTarget[] {
  if (fromPath.length === 0) return [];
  const moved = sectorAtPath(config, fromPath);
  if (!moved) return [];
  const height = sectorHeight(moved);
  const fromRing = fromPath.slice(0, -1);

  const targets: MoveTarget[] = [];
  const visit = (sectors: readonly MenuSector[], ringPath: number[], labels: string[]): void => {
    const eligible =
      !eqPath(ringPath, fromRing) && // not the current ring (no-op)
      !isPrefix(fromPath, ringPath) && // not inside the moved subtree (cycle)
      ringPath.length + height <= MAX_MENU_DEPTH; // fits the depth cap
    if (eligible) {
      targets.push({
        path: [...ringPath],
        label: labels.length ? labels.join(' › ') : 'Top level',
      });
    }
    sectors.forEach((sector, i) => {
      if (sector.children && sector.children.length > 0) {
        visit(sector.children, [...ringPath, i], [...labels, sector.label]);
      }
    });
  };
  visit(config.sectors, [], []);
  return targets;
}

/**
 * Index path to the sector carrying `id`, or null. Used to re-locate a
 * sector by its stable id after a move, since index paths shift when a
 * shared ancestor ring is spliced.
 */
export function pathOfSectorId(config: MenuConfig, id: string): number[] | null {
  const search = (sectors: readonly MenuSector[], prefix: number[]): number[] | null => {
    for (let i = 0; i < sectors.length; i++) {
      const sector = sectors[i]!;
      if (sector.id === id) return [...prefix, i];
      if (sector.children) {
        const found = search(sector.children, [...prefix, i]);
        if (found) return found;
      }
    }
    return null;
  };
  return search(config.sectors, []);
}
