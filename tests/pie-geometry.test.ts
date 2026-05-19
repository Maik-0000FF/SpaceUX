// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PIE_GEOMETRY,
  axesMagnitude,
  axesToSector,
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

describe('axesMagnitude', () => {
  it('returns 0 for zero axes', () => {
    expect(axesMagnitude({ tx: 0, ty: 0 })).toBe(0);
  });

  it('matches Euclidean distance', () => {
    expect(axesMagnitude({ tx: 3, ty: 4 })).toBe(5);
    expect(axesMagnitude({ tx: -3, ty: -4 })).toBe(5);
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
