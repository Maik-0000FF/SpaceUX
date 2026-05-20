// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { moveTarget } from '../src/editor/state/reorder';

// moveTarget maps a drop-line insertion index to moveSector's `to`
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
