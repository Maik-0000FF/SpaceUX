// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PIE_GEOMETRY,
  aimAxes,
  axesMagnitude,
  axesToSector,
  axisValue,
  backAxisEngaged,
  clampPieAnchor,
  cycleStepFromInputs,
  gestureActive,
  inputActive,
  meetsActivation,
  rotateAxes,
  sectorCenterAngle,
  twistCycleStep,
  type GestureFrame,
  type PieGeometryConfig,
  type SixAxes,
} from '../src/core/pie-geometry';
import type { GestureBinding, InputBinding } from '../src/shared/menu';

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

describe('axisValue', () => {
  const axes: SixAxes = { tx: 1, ty: 2, tz: 3, rx: 4, ry: 5, rz: 6 };
  it('reads each named axis from the six-axis snapshot', () => {
    expect(axisValue(axes, 'tx')).toBe(1);
    expect(axisValue(axes, 'ty')).toBe(2);
    expect(axisValue(axes, 'tz')).toBe(3);
    expect(axisValue(axes, 'rx')).toBe(4);
    expect(axisValue(axes, 'ry')).toBe(5);
    expect(axisValue(axes, 'rz')).toBe(6);
  });
});

describe('meetsActivation', () => {
  const T = 100;
  it('positive fires only above +threshold (strict)', () => {
    expect(meetsActivation(101, 'positive', T)).toBe(true);
    expect(meetsActivation(T, 'positive', T)).toBe(false); // exactly on → no
    expect(meetsActivation(50, 'positive', T)).toBe(false);
    expect(meetsActivation(-101, 'positive', T)).toBe(false); // wrong side
  });

  it('negative fires only below -threshold (strict)', () => {
    expect(meetsActivation(-101, 'negative', T)).toBe(true);
    expect(meetsActivation(-T, 'negative', T)).toBe(false);
    expect(meetsActivation(-50, 'negative', T)).toBe(false);
    expect(meetsActivation(101, 'negative', T)).toBe(false); // wrong side
  });

  it('both fires on either side past the magnitude (direction-agnostic)', () => {
    expect(meetsActivation(101, 'both', T)).toBe(true);
    expect(meetsActivation(-101, 'both', T)).toBe(true);
    expect(meetsActivation(T, 'both', T)).toBe(false);
    expect(meetsActivation(-T, 'both', T)).toBe(false);
    expect(meetsActivation(0, 'both', T)).toBe(false);
  });
});

describe('cycleStepFromInputs', () => {
  const ZERO: SixAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
  const rzCycle: InputBinding[] = [{ kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 }];

  it('derives the step sign from the first axis input', () => {
    expect(cycleStepFromInputs(rzCycle, { ...ZERO, rz: 150 })).toBe(1);
    expect(cycleStepFromInputs(rzCycle, { ...ZERO, rz: -150 })).toBe(-1);
    expect(cycleStepFromInputs(rzCycle, { ...ZERO, rz: 50 })).toBe(0); // under threshold
  });

  it('skips non-axis inputs (button/magnitude carry no direction)', () => {
    const inputs: InputBinding[] = [
      { kind: 'button', button: 0 },
      { kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 },
    ];
    expect(cycleStepFromInputs(inputs, { ...ZERO, rz: 150 })).toBe(1);
  });

  it('is 0 with no inputs', () => {
    expect(cycleStepFromInputs([], { ...ZERO, rz: 999 })).toBe(0);
  });
});

describe('backAxisEngaged', () => {
  const ZERO: SixAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };

  it('engages past the threshold in either direction (|value|)', () => {
    const back: GestureBinding = {
      inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }],
    };
    expect(backAxisEngaged(back, { ...ZERO, tz: 60 })).toBe(true);
    expect(backAxisEngaged(back, { ...ZERO, tz: -60 })).toBe(true);
    expect(backAxisEngaged(back, { ...ZERO, tz: 40 })).toBe(false);
  });

  it('is direction-aware — a directional back leaves its other half free (#160)', () => {
    const back: GestureBinding = {
      inputs: [{ kind: 'axis', axis: 'tz', direction: 'negative', threshold: 50 }],
    };
    // back is TZ−: a negative deflection still suppresses lateral...
    expect(backAxisEngaged(back, { ...ZERO, tz: -60 })).toBe(true);
    // ...but the positive half is now free (e.g. for a TZ+ drill — the
    // Press/Lift split), no longer quieted by the cross-talk guard.
    expect(backAxisEngaged(back, { ...ZERO, tz: 60 })).toBe(false);
  });

  it('ignores non-axis inputs', () => {
    const back: GestureBinding = { inputs: [{ kind: 'button', button: 0 }] };
    expect(backAxisEngaged(back, { ...ZERO, tz: 999 })).toBe(false);
  });
});

describe('twistCycleStep', () => {
  const T = 100;
  it('returns +1 for a positive twist past the threshold (next, clockwise)', () => {
    expect(twistCycleStep(101, T)).toBe(1);
    expect(twistCycleStep(500, T)).toBe(1);
  });
  it('returns -1 for a negative twist past the threshold (previous)', () => {
    expect(twistCycleStep(-101, T)).toBe(-1);
  });
  it('returns 0 within the threshold band (strict-greater, like the other twist gestures)', () => {
    expect(twistCycleStep(0, T)).toBe(0);
    expect(twistCycleStep(T, T)).toBe(0); // exactly on → no step
    expect(twistCycleStep(-T, T)).toBe(0);
    expect(twistCycleStep(50, T)).toBe(0);
  });
});

describe('inputActive', () => {
  const ZERO: SixAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
  const frame = (axes: Partial<SixAxes>, buttons: boolean[] = []): GestureFrame => ({
    axes: { ...ZERO, ...axes },
    buttons,
  });

  it('button: active only while the indexed button is held', () => {
    const b: InputBinding = { kind: 'button', button: 2 };
    expect(inputActive(b, frame({}, [false, false, true]))).toBe(true);
    expect(inputActive(b, frame({}, [false, false, false]))).toBe(false);
    expect(inputActive(b, frame({}, []))).toBe(false); // out of range
  });

  it('axis: respects direction + threshold (reuses meetsActivation)', () => {
    const up: InputBinding = { kind: 'axis', axis: 'tz', direction: 'positive', threshold: 100 };
    expect(inputActive(up, frame({ tz: 150 }))).toBe(true);
    expect(inputActive(up, frame({ tz: -150 }))).toBe(false); // wrong side
    expect(inputActive(up, frame({ tz: 50 }))).toBe(false); // under threshold
  });

  it('magnitude: lateral = hypot(tx,ty), tilt = hypot(rx,ry)', () => {
    const lateral: InputBinding = { kind: 'magnitude', source: 'lateral', threshold: 100 };
    const tilt: InputBinding = { kind: 'magnitude', source: 'tilt', threshold: 100 };
    expect(inputActive(lateral, frame({ tx: 80, ty: 80 }))).toBe(true); // hypot ≈ 113
    expect(inputActive(lateral, frame({ rx: 80, ry: 80 }))).toBe(false); // tilt doesn't drive lateral
    expect(inputActive(tilt, frame({ rx: 80, ry: 80 }))).toBe(true);
    expect(inputActive(tilt, frame({ tx: 80, ty: 80 }))).toBe(false);
  });

  it('none: never active', () => {
    expect(inputActive({ kind: 'none' }, frame({ tz: 999 }, [true]))).toBe(false);
  });
});

describe('gestureActive', () => {
  const ZERO: SixAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
  const frame = (axes: Partial<SixAxes>): GestureFrame => ({
    axes: { ...ZERO, ...axes },
    buttons: [],
  });

  it('is true when ANY input is satisfied', () => {
    const gesture = {
      inputs: [
        { kind: 'magnitude', source: 'lateral', threshold: 100 },
        { kind: 'axis', axis: 'rz', direction: 'both', threshold: 100 },
      ] as InputBinding[],
    };
    expect(gestureActive(gesture, frame({ rz: 150 }))).toBe(true); // second input
    expect(gestureActive(gesture, frame({ tx: 200 }))).toBe(true); // first input
    expect(gestureActive(gesture, frame({ rz: 50 }))).toBe(false); // neither
  });

  it('a gesture with no inputs is never active', () => {
    expect(gestureActive({ inputs: [] }, frame({ tz: 999 }))).toBe(false);
  });
});

describe('aimAxes (#159)', () => {
  const axes: SixAxes = { tx: 10, ty: 20, tz: 30, rx: 100, ry: 200, rz: 300 };

  it('push reads the lateral push (TX/TY)', () => {
    expect(aimAxes('push', axes)).toEqual({ tx: 10, ty: 20 });
  });

  it('tilt maps RY→horizontal (negated), RX→vertical (matching push)', () => {
    // axes.ry = 200 → tx = −200 (tilt-left reads RY+, must aim −x);
    // axes.rx = 100 → ty.
    expect(aimAxes('tilt', axes)).toEqual({ tx: -200, ty: 100 });
  });

  it('both sums push with the matching tilt axis (TX−RY, TY+RX)', () => {
    expect(aimAxes('both', axes)).toEqual({ tx: 10 - 200, ty: 20 + 100 });
  });

  it('twist has no lateral pointer (null) — selection moves by stepping only', () => {
    expect(aimAxes('twist', axes)).toBeNull();
  });
});
