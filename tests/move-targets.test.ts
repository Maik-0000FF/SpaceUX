// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { MenuConfig } from '@/shared/menu';

import { moveTargets, sectorHeight } from '../src/editor/state/move-targets';

// A (leaf), B (branch) → [B0 (leaf), B1 (branch) → [B1a (leaf)]].
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

describe('sectorHeight', () => {
  it('is 0 for a leaf and counts the deepest descendant otherwise', () => {
    expect(sectorHeight(cfg.sectors[0]!)).toBe(0); // A
    expect(sectorHeight(cfg.sectors[1]!)).toBe(2); // B → B1 → B1a
  });
});

describe('moveTargets', () => {
  it('offers other rings for a leaf, excluding its own ring', () => {
    // A lives in the root ring, so root is excluded; B and B1 remain.
    expect(moveTargets(cfg, [0])).toEqual([
      { path: [1], label: 'B' },
      { path: [1, 1], label: 'B › B1' },
    ]);
  });

  it('excludes the current ring and the moved subtree (no cycle)', () => {
    // B is a root sector; root is its current ring and [1]/[1,1] are inside
    // its own subtree, so there's nowhere valid to move it.
    expect(moveTargets(cfg, [1])).toEqual([]);
  });

  it('lets a nested leaf move up to the top level or to a sibling submenu', () => {
    expect(moveTargets(cfg, [1, 0])).toEqual([
      { path: [], label: 'Top level' },
      { path: [1, 1], label: 'B › B1' },
    ]);
  });
});
