// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { dropGapForRow, dropOwnerSibling, moveTarget } from '../src/editor/state/reorder';

// moveTarget maps a drop-line insertion index to moveNode's `to`
// argument, accounting for the splice-out shift. Pure, so tested here.
describe('moveTarget', () => {
  it('is a no-op when dropping into the item own slot or the gap after it', () => {
    expect(moveTarget(1, 1)).toBeNull(); // own slot
    expect(moveTarget(1, 2)).toBeNull(); // gap right after itself
  });

  it('drags downward: insertion index shifts left by one', () => {
    expect(moveTarget(0, 2)).toBe(1);
    expect(moveTarget(0, 3)).toBe(2);
    expect(moveTarget(1, 4)).toBe(3);
  });

  it('drags upward: insertion index is used as-is', () => {
    expect(moveTarget(2, 0)).toBe(0);
    expect(moveTarget(3, 1)).toBe(1);
    expect(moveTarget(2, 1)).toBe(1);
  });
});

// dropOwnerSibling maps a flattened-tree row back to the drag ring's sibling
// it belongs to, so a sibling's whole block (row + expanded subtree) drives
// the drop affordance.
describe('dropOwnerSibling', () => {
  it('returns the sibling index for a row directly in the ring', () => {
    expect(dropOwnerSibling([0], [])).toBe(0);
    expect(dropOwnerSibling([2], [])).toBe(2);
    expect(dropOwnerSibling([1, 0], [1])).toBe(0);
    expect(dropOwnerSibling([1, 2], [1])).toBe(2);
  });

  it('maps a descendant to the owning sibling of the ring', () => {
    expect(dropOwnerSibling([1, 0], [])).toBe(1); // child of top-level sibling 1
    expect(dropOwnerSibling([2, 3, 0], [])).toBe(2); // grandchild under sibling 2
    expect(dropOwnerSibling([1, 0, 0], [1])).toBe(0); // grandchild within ring [1]
  });

  it('returns null for the ring itself or a row outside it', () => {
    expect(dropOwnerSibling([], [])).toBeNull(); // the ring (root), not a sibling
    expect(dropOwnerSibling([1], [1])).toBeNull(); // the branch we are dragging within
    expect(dropOwnerSibling([2, 0], [1])).toBeNull(); // different branch's subtree
    expect(dropOwnerSibling([0], [1])).toBeNull(); // shorter / non-matching prefix
  });
});

// dropGapForRow turns a hovered row + pointer half into the insertion gap.
describe('dropGapForRow', () => {
  it('splits a sibling row at its midpoint', () => {
    expect(dropGapForRow([1], [], false)).toBe(1); // top half → before sibling 1
    expect(dropGapForRow([1], [], true)).toBe(2); // bottom half → after sibling 1
  });

  it('treats any descendant as "after" its sibling regardless of half', () => {
    expect(dropGapForRow([1, 0], [], false)).toBe(2); // first child, top half
    expect(dropGapForRow([1, 5], [], true)).toBe(2); // last child, bottom half
    expect(dropGapForRow([2, 0, 0], [], false)).toBe(3); // grandchild under sibling 2
  });

  it('returns null when the row is outside the drag ring', () => {
    expect(dropGapForRow([], [], true)).toBeNull();
    expect(dropGapForRow([2, 0], [1], false)).toBeNull();
  });
});
