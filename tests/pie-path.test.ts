// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  describeModernWedgePath,
  describeWedgePath,
  sampledCirclePolygon,
  sampledWedgePolygon,
} from '../src/core/pie-path';

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

  it('emits a donut path when sweep is a full 2π (single-sector ring)', () => {
    // The regular wedge path's start and end coincide at sweep = 2π
    // and the rendered shape collapses to a radial line. A donut
    // (two concentric circles, inner one punched out via
    // fill-rule: evenodd) is what users actually see for a 1-child
    // outer ring. Pin both subpaths so a future "simplify the
    // dispatch" refactor can't accidentally lose one.
    const path = describeWedgePath(100, 50, -Math.PI, Math.PI);
    // Two M…Z subpaths, one for each circle.
    expect(path.match(/M /g)).toHaveLength(2);
    expect(path.match(/Z/g)).toHaveLength(2);
    // Outer-circle anchor at +rOuter on x-axis, inner at +rInner.
    expect(path).toContain('M 100 0');
    expect(path).toContain('M 50 0');
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

describe('describeModernWedgePath: parallel gaps (#47)', () => {
  it('pins a 4-sector parallel wedge (constant-width gap)', () => {
    // index 0 of a 4-sector ring: a = -π/4, b = π/4. The side edges are pulled
    // inward by asin(d/R) at each radius (d = gap/2 = 10), so the inner edge
    // starts at a steeper offset than the outer one. Pinning the full string
    // locks both offsets, the straight L edges, and the arc flags at once. A
    // regression in the asin offset or the screen-coordinate convention fails
    // here.
    const path = describeModernWedgePath(240, 100, -Math.PI / 4, Math.PI / 4, 20);
    expect(path).toBe(
      'M -63.285 -77.427 ' +
        'L -162.487 -176.629 ' +
        'A 240 240 0 0 1 162.487 -176.629 ' +
        'L 63.285 -77.427 ' +
        'A 100 100 0 0 0 -63.285 -77.427 ' +
        'Z',
    );
  });

  it('uses largeArc=1 once the gapped span crosses π', () => {
    // The flag tracks the drawn (gapped) span aOutHi - aOutLo, not the raw
    // sweep: a sweep just past π minus the two small asin offsets is still > π,
    // so both arcs take the large-arc path. Pin the flags (outer sweeps
    // clockwise, inner reversed) so a future change to the offset can't quietly
    // flip them.
    const path = describeModernWedgePath(100, 50, 0, Math.PI + 0.2, 10);
    expect(path).toMatch(/A 100 100 0 1 1 /);
    expect(path).toMatch(/A 50 50 0 1 0 /);
  });

  it('delegates to the classic donut at a full 2π sweep (no neighbour to gap)', () => {
    // A 1-sector ring sweeps the whole circle, so there is no adjacent wedge to
    // gap against. The modern builder must fall back to the classic donut path
    // byte-for-byte rather than trying to offset a non-existent side edge.
    const modern = describeModernWedgePath(100, 50, -Math.PI, Math.PI, 20);
    expect(modern).toBe(describeWedgePath(100, 50, -Math.PI, Math.PI));
  });
});

describe('sampledWedgePolygon / sampledCirclePolygon (#47 PR2)', () => {
  it('returns a closed, even-length point list inside the outer radius', () => {
    const poly = sampledWedgePolygon(240, 100, -Math.PI / 4, Math.PI / 4, 20, 'parallel', 8);
    // (segments + 1) outer + (segments + 1) inner points, two numbers each.
    expect(poly).toHaveLength(4 * (8 + 1));
    expect(poly.length % 2).toBe(0);
    for (let i = 0; i < poly.length; i += 2) {
      expect(Math.hypot(poly[i]!, poly[i + 1]!)).toBeLessThanOrEqual(240 + 1);
    }
  });

  it('produces different polygons for the parallel and wedge gap shapes', () => {
    const a = sampledWedgePolygon(240, 100, -Math.PI / 4, Math.PI / 4, 20, 'parallel', 8);
    const b = sampledWedgePolygon(240, 100, -Math.PI / 4, Math.PI / 4, 20, 'wedge', 8);
    expect(a).not.toEqual(b);
  });

  it('samples a circle with `segments` points all on the radius', () => {
    const c = sampledCirclePolygon(50, 12);
    expect(c).toHaveLength(12 * 2);
    for (let i = 0; i < c.length; i += 2) {
      expect(Math.hypot(c[i]!, c[i + 1]!)).toBeCloseTo(50, 1);
    }
  });
});
