// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { MenuConfig } from '@/shared/menu';

import { buildRings } from '../src/editor/state/preview-rings';

// buildRings turns a selection path into the stacked preview rings, so it's
// pure navigation/geometry and tested here without a DOM.
const cfg: MenuConfig = {
  version: 1,
  sectors: [
    { label: 'A', binding: { action: 'p/a' } },
    {
      label: 'B',
      children: [
        { label: 'B0', binding: { action: 'p/a' } },
        { label: 'B1', children: [{ label: 'B1a', binding: { action: 'p/a' } }] },
      ],
    },
  ],
};

describe('buildRings', () => {
  it('empty path → just the root ring, nothing selected', () => {
    const rings = buildRings(cfg, []);
    expect(rings).toHaveLength(1);
    expect(rings[0]!.basePath).toEqual([]);
    expect(rings[0]!.selectedIndex).toBeNull();
    expect(rings[0]!.sectors.map((s) => s.label)).toEqual(['A', 'B']);
  });

  it('selecting a leaf adds no outer ring', () => {
    const rings = buildRings(cfg, [0]); // A is a leaf
    expect(rings).toHaveLength(1);
    expect(rings[0]!.selectedIndex).toBe(0);
  });

  it('selecting a branch adds its children as the outer ring', () => {
    const rings = buildRings(cfg, [1]); // B is a branch
    expect(rings).toHaveLength(2);
    expect(rings[0]!.selectedIndex).toBe(1);
    expect(rings[1]!.basePath).toEqual([1]);
    expect(rings[1]!.selectedIndex).toBeNull();
    expect(rings[1]!.sectors.map((s) => s.label)).toEqual(['B0', 'B1']);
  });

  it('walks deeper, accumulating rotation per level', () => {
    const rings = buildRings(cfg, [1, 1]); // B → B1 (branch)
    expect(rings.map((r) => r.basePath)).toEqual([[], [1], [1, 1]]);
    expect(rings[2]!.sectors.map((s) => s.label)).toEqual(['B1a']);
    // root: 0; level 1 rotates by sectorCenterAngle(1,2)=π; level 2 by +π.
    expect(rings[0]!.rotation).toBe(0);
    expect(rings[1]!.rotation).toBeCloseTo(Math.PI);
    expect(rings[2]!.rotation).toBeCloseTo(2 * Math.PI);
  });
});
