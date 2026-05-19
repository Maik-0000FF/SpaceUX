// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PIE_GEOMETRY,
  axesMagnitude,
  axesToSector,
  clampPieAnchor,
  resolveTzDeadzone,
  rotateAxes,
  sectorCenterAngle,
  shouldCancelOnZ,
  type PieGeometryConfig,
} from '../src/core/pie-geometry';

describe('axesToSector', () => {
  const eight: PieGeometryConfig = { sectorCount: 8, deadzone: 50, invertX: false, invertY: true };

  it('returns null inside the deadzone', () => {
    expect(axesToSector({ tx: 0, ty: 0 }, eight)).toBeNull();
    expect(axesToSector({ tx: 10, ty: 10 }, eight)).toBeNull();
  });

  it("maps strong up deflection to sector 0 (12 o'clock)", () => {
    // invertY=true → ty > 0 on the puck means "forward push" which we
    // display as "up" on screen, i.e. sector 0.
    expect(axesToSector({ tx: 0, ty: 200 }, eight)).toBe(0);
  });

  it("maps strong right deflection to sector 2 (3 o'clock) in an 8-sector pie", () => {
    expect(axesToSector({ tx: 200, ty: 0 }, eight)).toBe(2);
  });

  it("maps strong down deflection to sector 4 (6 o'clock)", () => {
    expect(axesToSector({ tx: 0, ty: -200 }, eight)).toBe(4);
  });

  it("maps strong left deflection to sector 6 (9 o'clock)", () => {
    expect(axesToSector({ tx: -200, ty: 0 }, eight)).toBe(6);
  });

  it('honours invertY=false (raw evdev sign)', () => {
    const noFlip: PieGeometryConfig = { ...eight, invertY: false };
    // With no flip, +ty means "down" on screen → sector 4.
    expect(axesToSector({ tx: 0, ty: 200 }, noFlip)).toBe(4);
  });

  it('clamps sectorCount below 2', () => {
    const tiny: PieGeometryConfig = { ...eight, sectorCount: 1 };
    // Clamped to 2; up deflection lands in sector 0.
    expect(axesToSector({ tx: 0, ty: 200 }, tiny)).toBe(0);
  });

  it('uses default geometry when none provided', () => {
    expect(axesToSector({ tx: 0, ty: 0 })).toBeNull();
    const s = axesToSector({ tx: 0, ty: 100 });
    expect(s).toBe(0);
    expect(DEFAULT_PIE_GEOMETRY.sectorCount).toBeGreaterThanOrEqual(2);
  });

  it('handles four-sector pies (cardinal directions)', () => {
    const four: PieGeometryConfig = {
      sectorCount: 4,
      deadzone: 50,
      invertX: false,
      invertY: true,
    };
    expect(axesToSector({ tx: 0, ty: 200 }, four)).toBe(0); // up
    expect(axesToSector({ tx: 200, ty: 0 }, four)).toBe(1); // right
    expect(axesToSector({ tx: 0, ty: -200 }, four)).toBe(2); // down
    expect(axesToSector({ tx: -200, ty: 0 }, four)).toBe(3); // left
  });
});

describe('sectorCenterAngle', () => {
  it("places sector 0 at 0 radians (12 o'clock)", () => {
    expect(sectorCenterAngle(0, 8)).toBe(0);
  });

  it('spaces sectors evenly around the circle', () => {
    expect(sectorCenterAngle(2, 8)).toBeCloseTo(Math.PI / 2);
    expect(sectorCenterAngle(4, 8)).toBeCloseTo(Math.PI);
    expect(sectorCenterAngle(6, 8)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('wraps modulo sectorCount', () => {
    expect(sectorCenterAngle(8, 8)).toBe(0);
    expect(sectorCenterAngle(9, 8)).toBeCloseTo(Math.PI / 4);
  });
});

describe('rotateAxes', () => {
  it('returns the input unchanged when angle is 0', () => {
    expect(rotateAxes({ tx: 3, ty: 4 }, 0)).toEqual({ tx: 3, ty: 4 });
  });

  it('rotates (1, 0) by +π/2 to (0, 1)', () => {
    // Pinning the rotation convention: positive angle rotates from
    // +X toward +Y. The puck-to-sector mapper in App.tsx passes
    // the *negative* of the ring offset, so flipping this
    // convention would silently put the puck on the wrong sector
    // after a drill.
    const result = rotateAxes({ tx: 1, ty: 0 }, Math.PI / 2);
    expect(result.tx).toBeCloseTo(0);
    expect(result.ty).toBeCloseTo(1);
  });

  it('round-trips by +θ then −θ back to the input', () => {
    const original = { tx: 2.5, ty: -1.3 };
    const out = rotateAxes(rotateAxes(original, Math.PI / 3), -Math.PI / 3);
    expect(out.tx).toBeCloseTo(original.tx);
    expect(out.ty).toBeCloseTo(original.ty);
  });
});

describe('axesMagnitude', () => {
  it('returns 0 for zero axes', () => {
    expect(axesMagnitude({ tx: 0, ty: 0 })).toBe(0);
  });

  it('matches Euclidean distance', () => {
    expect(axesMagnitude({ tx: 3, ty: 4 })).toBe(5);
    expect(axesMagnitude({ tx: -3, ty: -4 })).toBe(5);
  });
});

describe('resolveTzDeadzone', () => {
  it('returns the lateral deadzone when tzDeadzone is omitted', () => {
    // Default fallback path: behaviour identical to "no separate TZ
    // threshold exists" before the field was introduced.
    const cfg: PieGeometryConfig = {
      sectorCount: 4,
      deadzone: 50,
      invertX: false,
      invertY: true,
    };
    expect(resolveTzDeadzone(cfg)).toBe(50);
  });

  it('returns tzDeadzone when set (and ignores the lateral value)', () => {
    // Raising the TZ threshold to filter cross-talk shouldn't drag
    // the lateral selection's sensitivity along with it.
    const cfg: PieGeometryConfig = {
      sectorCount: 4,
      deadzone: 50,
      tzDeadzone: 120,
      invertX: false,
      invertY: true,
    };
    expect(resolveTzDeadzone(cfg)).toBe(120);
  });

  it('honours an explicit tzDeadzone of 0 as "no TZ threshold"', () => {
    // `?? deadzone` only fills the gap on `undefined` — a literal 0
    // means "fire on any TZ deflection". Edge-case but worth a pin
    // so a future "tzDeadzone || deadzone" refactor (which would
    // collapse 0 to the lateral fallback) fails here.
    const cfg: PieGeometryConfig = {
      sectorCount: 4,
      deadzone: 50,
      tzDeadzone: 0,
      invertX: false,
      invertY: true,
    };
    expect(resolveTzDeadzone(cfg)).toBe(0);
  });
});

describe('shouldCancelOnZ', () => {
  // The deadzone parameter is the user-facing threshold; pick 50 in
  // tests for parity with DEFAULT_PIE_GEOMETRY.deadzone.
  const DZ = 50;

  it('does not fire when tz is exactly zero', () => {
    expect(shouldCancelOnZ(0, DZ)).toBe(false);
  });

  it('does not fire inside the deadzone (positive and negative)', () => {
    expect(shouldCancelOnZ(40, DZ)).toBe(false);
    expect(shouldCancelOnZ(-40, DZ)).toBe(false);
    expect(shouldCancelOnZ(DZ, DZ)).toBe(false);
    expect(shouldCancelOnZ(-DZ, DZ)).toBe(false);
  });

  it('fires past the deadzone in either direction (symmetry guard)', () => {
    // The whole point of the helper is that push and pull both
    // register — pin both signs explicitly so a future "only count
    // negative tz" tweak fails this test instead of silently
    // breaking users with the opposite puck polarity.
    expect(shouldCancelOnZ(51, DZ)).toBe(true);
    expect(shouldCancelOnZ(-51, DZ)).toBe(true);
    expect(shouldCancelOnZ(100, DZ)).toBe(true);
    expect(shouldCancelOnZ(-100, DZ)).toBe(true);
  });

  it('honours different deadzone values', () => {
    expect(shouldCancelOnZ(10, 5)).toBe(true);
    expect(shouldCancelOnZ(10, 50)).toBe(false);
  });
});

describe('clampPieAnchor', () => {
  // A typical viewport on a desktop monitor + the default pie radius.
  // Centring keeps the anchor unchanged everywhere except near the
  // edges, so most tests below feed values inside the safe rectangle
  // and assert pass-through.
  const VIEWPORT = { width: 1920, height: 1080 };
  const RADIUS = 240;

  it('returns the point unchanged when well inside the viewport', () => {
    expect(clampPieAnchor({ x: 960, y: 540 }, RADIUS, VIEWPORT)).toEqual({ x: 960, y: 540 });
    expect(clampPieAnchor({ x: 500, y: 800 }, RADIUS, VIEWPORT)).toEqual({ x: 500, y: 800 });
  });

  it('pulls the anchor away from each edge by exactly radius', () => {
    // Top-left corner: clamps both axes to RADIUS so the pie touches
    // the edges but the full circle stays inside.
    expect(clampPieAnchor({ x: 0, y: 0 }, RADIUS, VIEWPORT)).toEqual({ x: RADIUS, y: RADIUS });
    // Bottom-right corner: mirror image.
    expect(clampPieAnchor({ x: 1920, y: 1080 }, RADIUS, VIEWPORT)).toEqual({
      x: 1920 - RADIUS,
      y: 1080 - RADIUS,
    });
  });

  it('clamps only the axis that crosses the edge', () => {
    // A cursor at the left edge mid-screen pulls only x; y is well
    // inside and passes through untouched.
    expect(clampPieAnchor({ x: 10, y: 540 }, RADIUS, VIEWPORT)).toEqual({ x: RADIUS, y: 540 });
    // Top edge mid-screen: pulls only y.
    expect(clampPieAnchor({ x: 960, y: 10 }, RADIUS, VIEWPORT)).toEqual({ x: 960, y: RADIUS });
    // Right edge: clamps x to the symmetric position.
    expect(clampPieAnchor({ x: 1910, y: 540 }, RADIUS, VIEWPORT)).toEqual({
      x: 1920 - RADIUS,
      y: 540,
    });
  });

  it('handles negative input coordinates symmetrically', () => {
    // Multi-monitor setups can briefly produce negative cursor coords
    // before the main process reassigns the overlay to the correct
    // display. The clamp must still produce a sane result.
    expect(clampPieAnchor({ x: -50, y: -50 }, RADIUS, VIEWPORT)).toEqual({
      x: RADIUS,
      y: RADIUS,
    });
  });

  it('falls back to the viewport centre when the pie is too big for the viewport', () => {
    // Tiny viewport that can't fit a 240-px pie: the clamp interval
    // collapses (Math.max(240, ...) would land above Math.min), so
    // the function emits the viewport centre on whichever axis is
    // too small. Predictable and symmetric beats meaningless.
    const tiny = { width: 100, height: 100 };
    expect(clampPieAnchor({ x: 50, y: 50 }, RADIUS, tiny)).toEqual({ x: 50, y: 50 });
    expect(clampPieAnchor({ x: 999, y: -999 }, RADIUS, tiny)).toEqual({ x: 50, y: 50 });
  });

  it('falls back to centre only on the axis that is too small', () => {
    // Tall thin viewport (e.g. portrait-rotated monitor with small
    // overlay): x can't fit 2*RADIUS, y can — clamp behaves
    // independently per axis.
    const tall = { width: 200, height: 1080 };
    expect(clampPieAnchor({ x: 999, y: 0 }, RADIUS, tall)).toEqual({ x: 100, y: RADIUS });
  });

  it('mirrors the tall-thin case for short-fat viewports', () => {
    // Symmetric counterpart to the test above: y can't fit 2*RADIUS,
    // x can. Pinned so a future "fix" that decouples the axes
    // asymmetrically fails here instead of silently regressing one
    // orientation.
    const shortFat = { width: 1080, height: 200 };
    expect(clampPieAnchor({ x: 0, y: 999 }, RADIUS, shortFat)).toEqual({ x: RADIUS, y: 100 });
  });
});
