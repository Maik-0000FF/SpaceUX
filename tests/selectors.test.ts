// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { MenuNode } from '@/shared/menu';

import { lastVisibleNodeKey } from '../src/editor/state/selectors';

// lastVisibleNodeKey picks the row that carries the drop-line for the gap
// after a ring's final sibling: the node itself when collapsed/leaf, otherwise
// the last visible descendant. Keyed on the editor `id` so it's deterministic.
describe('lastVisibleNodeKey', () => {
  const leaf: MenuNode = { label: 'leaf', id: 'leaf' };

  it('returns the node key for a leaf', () => {
    expect(lastVisibleNodeKey(leaf, new Set())).toBe('leaf');
  });

  it('returns the node key for a collapsed branch', () => {
    const branch: MenuNode = {
      label: 'b',
      id: 'b',
      branches: [{ label: 'c', id: 'c' }],
    };
    expect(lastVisibleNodeKey(branch, new Set())).toBe('b');
  });

  it('descends into the last expanded branch to its last visible row', () => {
    const branch: MenuNode = {
      label: 'b',
      id: 'b',
      branches: [
        { label: 'c1', id: 'c1' },
        { label: 'c2', id: 'c2' },
      ],
    };
    expect(lastVisibleNodeKey(branch, new Set(['b']))).toBe('c2');
  });

  it('stops at the deepest expanded level (nested grandchild)', () => {
    const branch: MenuNode = {
      label: 'b',
      id: 'b',
      branches: [
        { label: 'c1', id: 'c1' },
        {
          label: 'c2',
          id: 'c2',
          branches: [
            { label: 'd1', id: 'd1' },
            { label: 'd2', id: 'd2' },
          ],
        },
      ],
    };
    // c2 expanded → its last child d2; c1 irrelevant (not the last sibling).
    expect(lastVisibleNodeKey(branch, new Set(['b', 'c2']))).toBe('d2');
    // c2 collapsed → stops at c2 itself.
    expect(lastVisibleNodeKey(branch, new Set(['b']))).toBe('c2');
  });
});
