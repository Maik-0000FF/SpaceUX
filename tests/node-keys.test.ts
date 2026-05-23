// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { MenuNode } from '@/shared/menu';

import { defaultItemLabel, isDefaultItemLabel, nodeKey } from '../src/editor/state/node-keys';

// nodeKey backs the editor list/preview React keys. The contract is
// pure object-identity, so it's exercised here without a DOM.
describe('nodeKey', () => {
  it('returns a stable key for the same node object', () => {
    const node: MenuNode = { label: 'A' };
    expect(nodeKey(node)).toBe(nodeKey(node));
  });

  it('gives distinct keys to distinct objects, even with equal contents', () => {
    const a: MenuNode = { label: 'Same' };
    const b: MenuNode = { label: 'Same' };
    expect(nodeKey(a)).not.toBe(nodeKey(b));
  });

  it('keeps each node its key across a reorder (splice preserves refs)', () => {
    const ring: MenuNode[] = [{ label: 'A' }, { label: 'B' }, { label: 'C' }];
    const before = ring.map(nodeKey);

    // Mirror the store's moveNode: splice the same object references.
    const [moved] = ring.splice(0, 1);
    ring.splice(2, 0, moved!);

    // Keys travel with the objects, not the positions.
    expect(ring.map(nodeKey)).toEqual([before[1], before[2], before[0]]);
  });
});

describe('defaultItemLabel', () => {
  it('encodes the 1-based tree path', () => {
    expect(defaultItemLabel([0])).toBe('Item 1');
    expect(defaultItemLabel([2, 0])).toBe('Item 3.1');
    expect(defaultItemLabel([0, 1, 0])).toBe('Item 1.2.1');
  });
});

describe('isDefaultItemLabel', () => {
  it('treats empty, "New item", and the path scheme as still-default', () => {
    expect(isDefaultItemLabel('')).toBe(true);
    expect(isDefaultItemLabel('New item')).toBe(true);
    expect(isDefaultItemLabel('Item 1')).toBe(true);
    expect(isDefaultItemLabel('Item 3.1.2')).toBe(true);
  });

  it('treats a customised label as not default', () => {
    expect(isDefaultItemLabel('Volume')).toBe(false);
    expect(isDefaultItemLabel('Item')).toBe(false); // no number
    expect(isDefaultItemLabel('Item 1.')).toBe(false); // trailing dot
    expect(isDefaultItemLabel('My Item 1')).toBe(false);
  });
});
