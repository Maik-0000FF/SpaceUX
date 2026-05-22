// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { MenuNode } from '@/shared/menu';

import { sectorKey } from '../src/editor/state/sector-keys';

// sectorKey backs the editor list/preview React keys. The contract is
// pure object-identity, so it's exercised here without a DOM.
describe('sectorKey', () => {
  it('returns a stable key for the same sector object', () => {
    const sector: MenuNode = { label: 'A' };
    expect(sectorKey(sector)).toBe(sectorKey(sector));
  });

  it('gives distinct keys to distinct objects, even with equal contents', () => {
    const a: MenuNode = { label: 'Same' };
    const b: MenuNode = { label: 'Same' };
    expect(sectorKey(a)).not.toBe(sectorKey(b));
  });

  it('keeps each sector its key across a reorder (splice preserves refs)', () => {
    const ring: MenuNode[] = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];
    const before = ring.map(sectorKey);

    // Mirror the store's moveSector: splice the same object references.
    const [moved] = ring.splice(0, 1);
    ring.splice(2, 0, moved!);

    // Keys travel with the objects, not the positions.
    expect(ring.map(sectorKey)).toEqual([before[1], before[2], before[0]]);
  });
});
