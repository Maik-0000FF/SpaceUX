// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { describeWedgePath } from '../src/core/pie-path';

describe('describeWedgePath — arc flags', () => {
  it('uses largeArc=0 at the boundary sweep of exactly π (two-sector pie)', () => {
    // The strict `> π` comparison means a half-pie wedge sits on the
    // small-arc side of the flag. SVG renders either flag identically
    // at exactly π, so the assertion is about pinning the choice, not
    // about visual outcome. A future "fix" that flips this to `>= π`
    // would silently shift every half-pie to the large-arc path.
    const path = describeWedgePath(100, 50, 0, Math.PI);
    expect(path).toMatch(/A 100 100 0 0 1 /);
    expect(path).toMatch(/A 50 50 0 0 0 /);
  });

  it('uses largeArc=1 once the sweep crosses π', () => {
    // Just past the boundary — drives the strict-greater branch.
    const path = describeWedgePath(100, 50, 0, Math.PI + 0.1);
    expect(path).toMatch(/A 100 100 0 1 1 /);
    expect(path).toMatch(/A 50 50 0 1 0 /);
  });

  it('always reverses the inner arc relative to the outer (donut hole)', () => {
    // The outer arc sweeps clockwise (flag 1); the inner sweeps
    // counter-clockwise (flag 0). Flipping either produces two
    // stacked filled pies instead of a hole in the middle. Pin so
    // a future "simplification" that uses the same flag for both
    // fails here.
    const path = describeWedgePath(100, 50, 0, Math.PI / 4);
    expect(path).toMatch(/A 100 100 0 \d 1 /);
    expect(path).toMatch(/A 50 50 0 \d 0 /);
  });
});

describe('describeWedgePath — coordinate output', () => {
  it("pins the standard 8-sector wedge at index 0 (12 o'clock)", () => {
    // Mirrors SectorWedge's call site: sectorCenterAngle(0, 8) = 0,
    // ±sectorWidth/2 = ±π/8. Pinning the full string locks every
    // coordinate, every flag, and the separator format in one go.
    const path = describeWedgePath(240, 100, -Math.PI / 8, Math.PI / 8);
    expect(path).toBe(
      'M -38.268 -92.388 ' +
        'L -91.844 -221.731 ' +
        'A 240 240 0 0 1 91.844 -221.731 ' +
        'L 38.268 -92.388 ' +
        'A 100 100 0 0 0 -38.268 -92.388 ' +
        'Z',
    );
  });

  it('emits a valid path when inner radius is zero (degenerate pizza slice)', () => {
    // Useful as a defensive pin if anyone later passes rInner=0 to
    // collapse the donut hole. The inner arc degenerates to a
    // zero-radius arc (still a valid SVG path token) and the closing
    // M/L/Z structure stays intact.
    const path = describeWedgePath(100, 0, 0, Math.PI / 4);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);
    expect(path).toMatch(/A 0 0 0 0 0 0\.000 0\.000/);
  });
});
