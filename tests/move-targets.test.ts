// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { MenuConfig } from '@/shared/menu';

import { moveTargets, pathOfSectorId, sectorHeight } from '../src/editor/state/move-targets';

// A (leaf), B (branch) → [B0 (leaf), B1 (branch) → [B1a (leaf)]].
const cfg: MenuConfig = {
  version: 1,
  root: {
    label: '',
    branches: [
      { label: 'A', action: { id: 'p/a' } },
      {
        label: 'B',
        branches: [
          { label: 'B0', action: { id: 'p/a' } },
          { label: 'B1', branches: [{ label: 'B1a', action: { id: 'p/a' } }] },
        ],
      },
    ],
  },
};

describe('sectorHeight', () => {
  it('is 0 for a leaf and counts the deepest descendant otherwise', () => {
    expect(sectorHeight(cfg.root.branches![0]!)).toBe(0); // A
    expect(sectorHeight(cfg.root.branches![1]!)).toBe(2); // B → B1 → B1a
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

describe('pathOfSectorId', () => {
  it('finds a sector by id at any depth, or null when absent', () => {
    const c: MenuConfig = {
      version: 1,
      root: {
        label: '',
        branches: [
          { label: 'A', id: 'a', action: { id: 'p/a' } },
          { label: 'B', id: 'b', branches: [{ label: 'C', id: 'c', action: { id: 'p/a' } }] },
        ],
      },
    };
    expect(pathOfSectorId(c, 'a')).toEqual([0]);
    expect(pathOfSectorId(c, 'c')).toEqual([1, 0]);
    expect(pathOfSectorId(c, 'nope')).toBeNull();
  });
});
